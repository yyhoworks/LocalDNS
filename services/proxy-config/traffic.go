package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type trafficSample struct {
	Time  int64   `json:"time"`
	Total float64 `json:"total"`
	Start float64 `json:"start"`
}
type trafficCollector struct {
	mu                    sync.Mutex
	directory, metricsURL string
	samples               []trafficSample
	problem               string
	persisted             bool
}

const trafficRetention = 7 * 24 * time.Hour

func newTrafficCollector(directory, metricsURL string) *trafficCollector {
	t := &trafficCollector{directory: directory, metricsURL: metricsURL, samples: []trafficSample{}}
	entries, _ := os.ReadDir(directory)
	for _, entry := range entries {
		hour, err := time.Parse("20060102-15.jsonl", entry.Name())
		if err != nil || entry.IsDir() {
			continue
		}
		if hour.Add(time.Hour).Before(time.Now().Add(-trafficRetention)) {
			os.Remove(filepath.Join(directory, entry.Name()))
			continue
		}
		file, err := os.Open(filepath.Join(directory, entry.Name()))
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			var sample trafficSample
			if json.Unmarshal(scanner.Bytes(), &sample) == nil && validTraffic(sample) {
				t.samples = append(t.samples, sample)
			}
		}
		file.Close()
	}
	sort.SliceStable(t.samples, func(i, j int) bool { return t.samples[i].Time < t.samples[j].Time })
	unique := t.samples[:0]
	for _, sample := range t.samples {
		if len(unique) == 0 || sample.Time > unique[len(unique)-1].Time {
			unique = append(unique, sample)
		}
	}
	t.samples = unique
	t.persisted = len(t.samples) > 0
	t.trim(time.Now().UnixMilli())
	return t
}
func validTraffic(s trafficSample) bool {
	return s.Time > 0 && s.Total >= 0 && s.Start > 0 && !math.IsNaN(s.Total) && !math.IsInf(s.Total, 0) && !math.IsNaN(s.Start) && !math.IsInf(s.Start, 0)
}
func (t *trafficCollector) trim(now int64) {
	cutoff := now - int64(trafficRetention/time.Millisecond)
	for len(t.samples) > 121000 || len(t.samples) > 0 && t.samples[0].Time < cutoff {
		t.samples = t.samples[1:]
	}
}
func parseTrafficMetrics(body io.Reader, now int64) (trafficSample, error) {
	sample := trafficSample{Time: now, Total: -1}
	scanner := bufio.NewScanner(io.LimitReader(body, 2<<20))
	scanner.Buffer(make([]byte, 4096), 65536)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		if fields[0] != "localdns_queries_total" && fields[0] != "process_start_time_seconds" {
			continue
		}
		value, err := strconv.ParseFloat(fields[1], 64)
		if err != nil {
			return sample, err
		}
		if fields[0] == "localdns_queries_total" {
			sample.Total = value
		} else {
			sample.Start = value
		}
	}
	if err := scanner.Err(); err != nil {
		return sample, err
	}
	if !validTraffic(sample) {
		return sample, errors.New("missing DNS query counter or start time")
	}
	return sample, nil
}
func (t *trafficCollector) record(sample trafficSample) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !validTraffic(sample) {
		return errors.New("invalid sample")
	}
	if len(t.samples) > 0 && sample.Time-t.samples[len(t.samples)-1].Time < 1500 {
		return nil
	}
	if err := os.MkdirAll(t.directory, 0o700); err != nil {
		return err
	}
	filename := filepath.Join(t.directory, time.UnixMilli(sample.Time).UTC().Format("20060102-15.jsonl"))
	data, _ := json.Marshal(sample)
	data = append(data, '\n')
	file, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	t.samples = append(t.samples, sample)
	t.trim(sample.Time)
	t.persisted = true
	// Whole expired hourly segments are removed; response filtering enforces the exact rolling window.
	entries, _ := os.ReadDir(t.directory)
	for _, entry := range entries {
		hour, err := time.Parse("20060102-15.jsonl", entry.Name())
		if err == nil && hour.Add(time.Hour).Before(time.UnixMilli(sample.Time).Add(-trafficRetention)) {
			os.Remove(filepath.Join(t.directory, entry.Name()))
		}
	}
	return nil
}
func (t *trafficCollector) collect(ctx context.Context) {
	req, err := http.NewRequestWithContext(ctx, "GET", t.metricsURL, nil)
	if err != nil {
		t.failed("采样地址无效，请检查服务设置。")
		return
	}
	client := &http.Client{Timeout: 4 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	response, err := client.Do(req)
	if err != nil {
		t.failed("暂时无法读取 DNS 计数，服务器会自动重试。")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.failed("DNS 计数接口暂时不可用，服务器会自动重试。")
		return
	}
	sample, err := parseTrafficMetrics(response.Body, time.Now().UnixMilli())
	if err != nil {
		t.failed("DNS 接口未返回有效计数，服务器会自动重试。")
		return
	}
	if err := t.record(sample); err != nil {
		t.failed("采样记录暂时无法保存，服务器会自动重试。")
		return
	}
	t.failed("")
}
func (t *trafficCollector) failed(message string) { t.mu.Lock(); t.problem = message; t.mu.Unlock() }
func (t *trafficCollector) run(ctx context.Context) {
	t.collect(ctx)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			t.collect(ctx)
		}
	}
}

type trafficPoint struct {
	Time    int64    `json:"time"`
	Delta   *float64 `json:"delta"`
	QPS     *float64 `json:"qps"`
	Elapsed float64  `json:"elapsed"`
	Peak    float64  `json:"peak"`
}

func trafficPoints(samples []trafficSample, minutes int, now int64) ([]trafficPoint, *float64) {
	cutoff := now - int64(minutes)*60000
	step := int64(5000)
	if minutes > 60 {
		step = 60000
	}
	if minutes > 1440 {
		step = 300000
	}
	if minutes > 4320 {
		step = 600000
	}
	points := []trafficPoint{}
	var bucket *trafficPoint
	var current *float64
	flush := func() {
		if bucket != nil {
			points = append(points, *bucket)
			bucket = nil
		}
	}
	for i, sample := range samples {
		if i == 0 {
			continue
		}
		previous := samples[i-1]
		elapsed := float64(sample.Time-previous.Time) / 1000
		valid := sample.Start == previous.Start && sample.Total >= previous.Total && elapsed > 0 && elapsed <= 90
		if i == len(samples)-1 && valid && now-sample.Time <= 90000 {
			rate := (sample.Total - previous.Total) / elapsed
			current = &rate
		}
		if sample.Time < cutoff || sample.Time > now {
			continue
		}
		if !valid || previous.Time < cutoff {
			flush()
			points = append(points, trafficPoint{Time: sample.Time})
			continue
		}
		delta := sample.Total - previous.Total
		rate := delta / elapsed
		if bucket != nil && bucket.Time/step != sample.Time/step {
			flush()
		}
		if bucket == nil {
			d := float64(0)
			q := float64(0)
			bucket = &trafficPoint{Delta: &d, QPS: &q}
		}
		bucket.Time = sample.Time
		*bucket.Delta += delta
		bucket.Elapsed += elapsed
		*bucket.QPS = *bucket.Delta / bucket.Elapsed
		if rate > bucket.Peak {
			bucket.Peak = rate
		}
	}
	flush()
	return points, current
}
func (s *Server) trafficHistory(w http.ResponseWriter, r *http.Request) error {
	if s.traffic == nil {
		return failure(503, "服务器采样服务尚未启动。")
	}
	minutes, _ := strconv.Atoi(r.URL.Query().Get("minutes"))
	if minutes == 0 {
		minutes = 60
	}
	if minutes != 60 && minutes != 360 && minutes != 1440 && minutes != 4320 && minutes != 10080 {
		return failure(400, "请选择 1 小时、6 小时、1 天、3 天或 7 天。")
	}
	t := s.traffic
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now().UnixMilli()
	points, current := trafficPoints(t.samples, minutes, now)
	writeJSON(w, 200, map[string]any{"points": points, "current": current, "now": now, "intervalSeconds": 5, "retentionSeconds": 604800, "source": "server", "persisted": t.persisted, "error": t.problem, "minutes": minutes})
	return nil
}
