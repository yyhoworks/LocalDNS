package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestServerTrafficPersistsWithoutBrowserAndSurvivesRestart(t *testing.T) {
	file := filepath.Join(t.TempDir(), "traffic.json")
	now := time.Now().UnixMilli()
	collector := newTrafficCollector(file, "")
	for i, total := range []float64{10, 20, 25} {
		if err := collector.record(trafficSample{Time: now + int64(i)*5000, Total: total, Start: 1}); err != nil {
			t.Fatal(err)
		}
	}
	restored := newTrafficCollector(file, "")
	if len(restored.samples) != 3 {
		t.Fatal("server lost history on restart")
	}
	entries, _ := os.ReadDir(file)
	info, _ := os.Stat(filepath.Join(file, entries[0].Name()))
	if info.Mode().Perm() != 0o600 {
		t.Fatal("history permissions")
	}
	if err := restored.record(trafficSample{Time: now + 15000, Total: 1, Start: 2}); err != nil {
		t.Fatal(err)
	}
	if len(restored.samples) != 4 {
		t.Fatal("DNS process reset erased history")
	}
}
func TestServerTrafficHandlesOutageAndRejectsMissingCounters(t *testing.T) {
	valid := true
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if valid {
			w.Write([]byte("localdns_queries_total 42\nprocess_start_time_seconds 100\n"))
		} else {
			w.WriteHeader(503)
		}
	}))
	defer upstream.Close()
	collector := newTrafficCollector(filepath.Join(t.TempDir(), "traffic.json"), upstream.URL)
	collector.collect(context.Background())
	if len(collector.samples) != 1 || collector.problem != "" {
		t.Fatal("server did not sample")
	}
	valid = false
	collector.collect(context.Background())
	if len(collector.samples) != 1 || collector.problem == "" {
		t.Fatal("outage erased history or fabricated zero")
	}
	for _, bad := range []string{"localdns_queries_total NaN\nprocess_start_time_seconds 100", "process_start_time_seconds 100", "localdns_queries_total 0"} {
		if _, err := parseTrafficMetrics(strings.NewReader(bad), 1); err == nil {
			t.Fatal("accepted missing/nonfinite counter")
		}
	}
}
func TestTrafficEndpointServesSameHistoryToNewClients(t *testing.T) {
	s, _ := testServer(t)
	s.traffic = newTrafficCollector(filepath.Join(t.TempDir(), "traffic.json"), "")
	s.traffic.record(trafficSample{Time: time.Now().UnixMilli(), Total: 20, Start: 1})
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "http://localdns.test:9098"+apiPrefix+"traffic", nil)
		req.Header.Set("Origin", "http://localdns.test:9099")
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, req)
		var data struct{ Points []trafficPoint }
		json.Unmarshal(rr.Body.Bytes(), &data)
		if rr.Code != 200 || len(data.Points) != 0 {
			t.Fatal(rr.Body.String())
		}
	}
}

func TestTrafficSevenDayExpiryAggregationAndRestartGaps(t *testing.T) {
	dir := t.TempDir()
	old := time.Now().Add(-8 * 24 * time.Hour)
	filename := filepath.Join(dir, old.UTC().Format("20060102-15.jsonl"))
	data, _ := json.Marshal(trafficSample{Time: old.UnixMilli(), Total: 1, Start: 1})
	os.WriteFile(filename, append(data, '\n'), 0o600)
	collector := newTrafficCollector(dir, "")
	if len(collector.samples) != 0 {
		t.Fatal("retained records older than seven days")
	}
	if _, err := os.Stat(filename); !os.IsNotExist(err) {
		t.Fatal("expired segment not removed")
	}
	now := time.Now().UnixMilli()
	samples := []trafficSample{{now - 30000, 100, 1}, {now - 25000, 110, 1}, {now - 20000, 130, 1}, {now - 15000, 1, 2}, {now - 10000, 6, 2}, {now - 5000, 6, 2}}
	for _, minutes := range []int{60, 360, 1440, 4320, 10080} {
		points, current := trafficPoints(samples, minutes, now)
		requests, seconds, peak := float64(0), float64(0), float64(0)
		gap := false
		for _, point := range points {
			if point.Delta != nil {
				requests += *point.Delta
				seconds += point.Elapsed
				if point.Peak > peak {
					peak = point.Peak
				}
			} else {
				gap = true
			}
		}
		if requests != 35 || seconds != 20 || peak != 4 || !gap || current == nil || *current != 0 {
			t.Fatalf("range %d lost counters, peaks or gaps: %+v", minutes, points)
		}
	}
}
