package tryon

import (
	"context"
	"fmt"
	"strings"
)

// IsCloudGeneration classifies a request before it consumes the cloud budget.
// Browser-provided configurations are always cloud-only because private/local endpoints are rejected.
func IsCloudGeneration(ctx context.Context, alias string, clientConfig *ModelConfig) (bool, error) {
	if clientConfig != nil {
		if _, err := NewGeneratorFromClientConfig(clientConfig); err != nil {
			return false, err
		}
		return true, nil
	}
	alias = strings.TrimSpace(alias)
	if alias == "" {
		alias = "gemini"
	}
	cfg := loadModelConfigCandidate(ctx, alias)
	if cfg == nil {
		return false, fmt.Errorf("模型 %s 未配置", alias)
	}
	return !strings.EqualFold(strings.TrimSpace(cfg.Provider), "comfyui"), nil
}
