package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const hookHealthTimeout = 3 * time.Second

// The reload API accepted the file before the hook ran. Only a subsequent
// health check can establish that the hook left the core online.
type hookError struct {
	err        error
	hasOutput  bool
	coreOnline bool
	healthErr  error
}

func (e *hookError) Error() string {
	message := "post reload hook failed: " + safeOperationError(e.err)
	if e.hasOutput {
		message += "；钩子输出已隐藏，避免泄露凭据"
	}
	if !e.coreOnline {
		message += "；核心在线状态未确认：" + safeOperationError(e.healthErr)
	}
	return message
}
func (e *hookError) Unwrap() error { return e.err }

func hookFailure(err error) bool {
	var target *hookError
	return errors.As(err, &target)
}

func coreRestored(err error) bool {
	var target *hookError
	return err == nil || (errors.As(err, &target) && target.coreOnline)
}

type controllerStatusError int

func (e controllerStatusError) Error() string { return fmt.Sprintf("controller returned %d", int(e)) }

// Error strings can contain argv[0], configuration values, URLs or arbitrary
// child output. Return only structured diagnostics, including for service logs.
func safeOperationError(err error) string {
	var hook *hookError
	var exit *exec.ExitError
	var status controllerStatusError
	var network net.Error
	switch {
	case err == nil:
		return "未取得检查结果"
	case errors.As(err, &hook):
		return hook.Error()
	case errors.Is(err, context.DeadlineExceeded):
		return "执行超时"
	case errors.Is(err, context.Canceled):
		return "执行已取消"
	case errors.Is(err, exec.ErrWaitDelay):
		return "等待子进程输出结束超时"
	case errors.Is(err, os.ErrNotExist), errors.Is(err, exec.ErrNotFound):
		return "文件或可执行程序不存在"
	case errors.Is(err, os.ErrPermission):
		return "访问或执行权限不足"
	case errors.As(err, &exit):
		if exit.ExitCode() < 0 {
			return "进程被信号终止"
		}
		return fmt.Sprintf("exit status %d", exit.ExitCode())
	case errors.As(err, &status):
		return status.Error()
	case errors.As(err, &network):
		if network.Timeout() {
			return "连接或响应超时"
		}
		return "控制接口连接失败"
	default:
		return fmt.Sprintf("操作失败（%T；具体值已隐藏）", err)
	}
}

func runPostReload(ctx context.Context, hook []string, address, secret string) error {
	// Both apply and rollback already have a 45 s budget. Reserve its last
	// three seconds for health checks, independent of the hook's cancellation.
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	deadline, _ := ctx.Deadline()
	hookCtx, stopHook := context.WithDeadline(ctx, deadline.Add(-hookHealthTimeout))
	cmd := exec.CommandContext(hookCtx, hook[0], hook[1:]...)
	cmd.WaitDelay = 200 * time.Millisecond
	var output boundedOutput
	cmd.Stdout, cmd.Stderr = &output, &output
	hookErr := cmd.Run()
	if hookCtx.Err() != nil {
		hookErr = hookCtx.Err()
	}
	stopHook()

	healthErr := waitForMihomoHealth(ctx, address, secret)
	if hookErr != nil {
		// Do not retain arbitrary output or argv in an externally printable error.
		return &hookError{err: hookErr, hasOutput: len(output.b) > 0, coreOnline: healthErr == nil, healthErr: healthErr}
	}
	return healthErr
}

func waitForMihomoHealth(ctx context.Context, address, secret string) error {
	ctx, cancel := context.WithTimeout(ctx, hookHealthTimeout)
	defer cancel()
	for {
		if err := apiCall(ctx, address, secret, "GET", "/version", nil); err == nil {
			return nil
		} else {
			timer := time.NewTimer(200 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return err
			case <-timer.C:
			}
		}
	}
}

func validatePostReload(config Config) error {
	// Only Mihomo executes postReload. Other cores must not be blocked by an
	// unused setting; adding hook support there requires its own lifecycle.
	if core, ok := config.Cores["mihomo"]; ok {
		return validateHook("mihomo", core.PostReload)
	}
	return nil
}

func validateHook(core string, hook []string) error {
	if len(hook) == 0 {
		return nil
	}
	for _, part := range hook {
		if strings.ContainsAny(part, "\x00\r\n") {
			return fmt.Errorf("%s 的 postReload 含换行或空字符；postReload 是 JSON 数组，每个元素是一个参数", core)
		}
	}
	program := hook[0]
	if program == "" {
		return fmt.Errorf("%s 的 postReload[0] 不能为空", core)
	}
	if !filepath.IsAbs(program) {
		return fmt.Errorf("%s 的 postReload[0] 必须是绝对路径。postReload 是 argv 数组，不按空格拆分或解释管道；例如 [\"/sbin/rc-service\", \"mihomo-gateway\", \"restart\"]。当前命令和参数已隐藏", core)
	}
	if _, err := os.Stat(program); err != nil {
		return fmt.Errorf("%s 的 postReload[0] 不存在或无法访问；路径已隐藏", core)
	}
	if !binaryAvailable(Core{Binary: program}) {
		return fmt.Errorf("%s 的 postReload[0] 不是可执行的普通文件；路径已隐藏", core)
	}
	return nil
}
