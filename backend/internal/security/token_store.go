package security

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

type TokenEntry struct {
	Hash        [32]byte
	PrincipalID string
}

type TokenStore struct {
	authRequired bool
	tokens       []TokenEntry
}

func NewTokenStore(authRequired bool, envKey string) (*TokenStore, error) {
	return NewTokenStoreWithConfig(authRequired, envKey, nil)
}

func NewTokenStoreWithConfig(authRequired bool, envKey string, configuredTokens []string) (*TokenStore, error) {
	if envKey == "" {
		envKey = "TRYON_API_KEYS"
	}
	rawEnv := os.Getenv(envKey)
	var tokens []TokenEntry
	parts := configuredTokens
	if strings.TrimSpace(rawEnv) != "" {
		parts = strings.Split(rawEnv, ",")
	}

	if len(parts) > 0 {
		for _, part := range parts {
			token := strings.TrimSpace(part)
			if token == "" {
				continue
			}
			if len(token) < 32 || len(token) > 512 {
				return nil, fmt.Errorf("后端访问 Token 长度无效（必须为 32 到 512 个字符）")
			}
			sum := sha256.Sum256([]byte(token))
			principalID := hex.EncodeToString(sum[:8]) // 前 16 个十六进制字符
			tokens = append(tokens, TokenEntry{
				Hash:        sum,
				PrincipalID: principalID,
			})
		}
	}

	if authRequired && len(tokens) == 0 {
		return nil, fmt.Errorf("security.authRequired 为 true，但未在 .env 或 config.yaml 中找到有效后端访问 Token（每个 Token 需 32~512 字符）")
	}

	return &TokenStore{
		authRequired: authRequired,
		tokens:       tokens,
	}, nil
}

func (s *TokenStore) IsAuthRequired() bool {
	return s.authRequired
}

func (s *TokenStore) HasTokens() bool {
	return len(s.tokens) > 0
}

func (s *TokenStore) ValidateToken(rawToken string) (string, bool) {
	token := strings.TrimSpace(rawToken)
	if len(token) < 32 || len(token) > 512 {
		return "", false
	}

	providedHash := sha256.Sum256([]byte(token))
	var matchedPrincipal string
	matched := false

	// 使用恒定时间逐个比对，不提前 break，避免泄露时序信息
	for _, entry := range s.tokens {
		if subtle.ConstantTimeCompare(providedHash[:], entry.Hash[:]) == 1 {
			matched = true
			matchedPrincipal = entry.PrincipalID
		}
	}

	if matched {
		return matchedPrincipal, true
	}
	return "", false
}
