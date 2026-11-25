package configenv

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/gogf/gf/v2/frame/g"
)

const EnvPrefix = "NVZHUANG_"

var envNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type Result struct {
	DotEnvPath string
	Overrides  int
}

// LoadDotEnv loads the first available backend .env file without replacing
// environment variables already supplied by the operating system or container.
func LoadDotEnv() (string, error) {
	for _, candidate := range []string{filepath.Join("backend", ".env"), ".env"} {
		info, err := os.Stat(candidate)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", fmt.Errorf("检查 .env 失败: %w", err)
		}
		if info.IsDir() {
			continue
		}
		if err := loadDotEnvFile(candidate); err != nil {
			return "", err
		}
		return filepath.Clean(candidate), nil
	}
	return "", nil
}

// ApplyOverrides maps every existing config.yaml leaf to an environment name.
// For example, server.address becomes NVZHUANG_SERVER_ADDRESS and
// llm.models.gpt-image.baseURL becomes NVZHUANG_LLM_MODELS_GPT_IMAGE_BASE_URL.
func ApplyOverrides(ctx context.Context) (int, error) {
	adapter, ok := g.Cfg().GetAdapter().(interface {
		Set(pattern string, value interface{}) error
	})
	if !ok {
		return 0, fmt.Errorf("当前配置适配器不支持环境变量覆盖")
	}
	data, err := g.Cfg().Data(ctx)
	if err != nil {
		return 0, fmt.Errorf("读取后端配置失败: %w", err)
	}
	overrides := 0
	var walk func(path []string, value interface{}) error
	walk = func(path []string, value interface{}) error {
		switch typed := value.(type) {
		case map[string]interface{}:
			for key, child := range typed {
				if err := walk(append(path, key), child); err != nil {
					return err
				}
			}
			return nil
		case map[interface{}]interface{}:
			for key, child := range typed {
				if err := walk(append(path, fmt.Sprint(key)), child); err != nil {
					return err
				}
			}
			return nil
		}
		if len(path) == 0 {
			return nil
		}
		envName := EnvName(path...)
		raw, exists := os.LookupEnv(envName)
		if !exists {
			return nil
		}
		parsed, err := parseOverrideValue(raw, value)
		if err != nil {
			return fmt.Errorf("环境变量 %s 格式无效: %w", envName, err)
		}
		if err := adapter.Set(strings.Join(path, "."), parsed); err != nil {
			return fmt.Errorf("应用环境变量 %s 失败: %w", envName, err)
		}
		overrides++
		return nil
	}
	if err := walk(nil, data); err != nil {
		return 0, err
	}
	return overrides, nil
}

func Init(ctx context.Context) (Result, error) {
	path, err := LoadDotEnv()
	if err != nil {
		return Result{}, err
	}
	overrides, err := ApplyOverrides(ctx)
	if err != nil {
		return Result{}, err
	}
	return Result{DotEnvPath: path, Overrides: overrides}, nil
}

func EnvName(path ...string) string {
	parts := make([]string, 0, len(path))
	for _, item := range path {
		parts = append(parts, toEnvSegment(item))
	}
	return EnvPrefix + strings.Join(parts, "_")
}

func toEnvSegment(value string) string {
	runes := []rune(value)
	var out strings.Builder
	lastUnderscore := false
	for index, current := range runes {
		if !unicode.IsLetter(current) && !unicode.IsDigit(current) {
			if out.Len() > 0 && !lastUnderscore {
				out.WriteByte('_')
				lastUnderscore = true
			}
			continue
		}
		if unicode.IsUpper(current) && index > 0 {
			previous := runes[index-1]
			var next rune
			if index+1 < len(runes) {
				next = runes[index+1]
			}
			if (unicode.IsLower(previous) || unicode.IsDigit(previous)) || (unicode.IsUpper(previous) && unicode.IsLower(next)) {
				if !lastUnderscore {
					out.WriteByte('_')
				}
			}
		}
		out.WriteRune(unicode.ToUpper(current))
		lastUnderscore = false
	}
	return strings.Trim(out.String(), "_")
}

func parseOverrideValue(raw string, current interface{}) (interface{}, error) {
	typeOf := reflect.TypeOf(current)
	if typeOf == nil || typeOf.Kind() != reflect.Slice {
		return raw, nil
	}
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "[") {
		var values []interface{}
		if err := json.Unmarshal([]byte(trimmed), &values); err != nil {
			return nil, fmt.Errorf("数组必须是 JSON 数组或英文逗号分隔文本")
		}
		return values, nil
	}
	if trimmed == "" {
		return []string{}, nil
	}
	parts := strings.Split(trimmed, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.TrimSpace(part); value != "" {
			values = append(values, value)
		}
	}
	return values, nil
}

func loadDotEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("打开 .env 失败: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "\ufeff"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || !envNamePattern.MatchString(key) {
			return fmt.Errorf("%s 第 %d 行不是有效的 KEY=VALUE 配置", filepath.Base(path), lineNumber)
		}
		parsed, err := parseDotEnvValue(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("%s 第 %d 行格式无效: %w", filepath.Base(path), lineNumber, err)
		}
		if _, exists := os.LookupEnv(key); !exists {
			if err := os.Setenv(key, parsed); err != nil {
				return fmt.Errorf("设置 .env 变量失败: %w", err)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("读取 .env 失败: %w", err)
	}
	return nil
}

func parseDotEnvValue(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if value[0] == '\'' {
		if len(value) < 2 || value[len(value)-1] != '\'' {
			return "", fmt.Errorf("单引号未闭合")
		}
		return value[1 : len(value)-1], nil
	}
	if value[0] == '"' {
		parsed, err := strconv.Unquote(value)
		if err != nil {
			return "", fmt.Errorf("双引号字符串无效")
		}
		return parsed, nil
	}
	for index, current := range value {
		if current == '#' && index > 0 && unicode.IsSpace(rune(value[index-1])) {
			return strings.TrimSpace(value[:index]), nil
		}
	}
	return strings.TrimSpace(value), nil
}
