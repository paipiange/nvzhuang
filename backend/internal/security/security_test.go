package security

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"testing"
)

func TestTokenStoreValidation(t *testing.T) {
	token1 := "12345678901234567890123456789012"     // 32 chars
	token2 := "abcdefabcdefabcdefabcdefabcdefabcdef" // 36 chars

	envKey := "TEST_TRYON_API_KEYS"
	os.Setenv(envKey, token1+","+token2)
	defer os.Unsetenv(envKey)

	store, err := NewTokenStore(true, envKey)
	if err != nil {
		t.Fatalf("failed to create TokenStore: %v", err)
	}

	// 验证 token1
	pid1, ok := store.ValidateToken(token1)
	if !ok {
		t.Fatal("expected token1 to be valid")
	}
	expectedHash1 := sha256.Sum256([]byte(token1))
	expectedPID1 := hex.EncodeToString(expectedHash1[:8])
	if pid1 != expectedPID1 {
		t.Fatalf("expected principal_id %s, got %s", expectedPID1, pid1)
	}

	// 验证 token2
	pid2, ok := store.ValidateToken("  " + token2 + "  ")
	if !ok {
		t.Fatal("expected trimmed token2 to be valid")
	}
	expectedHash2 := sha256.Sum256([]byte(token2))
	expectedPID2 := hex.EncodeToString(expectedHash2[:8])
	if pid2 != expectedPID2 {
		t.Fatalf("expected principal_id %s, got %s", expectedPID2, pid2)
	}

	// 验证非法 token
	if _, ok := store.ValidateToken("short-token"); ok {
		t.Fatal("expected short token to be rejected")
	}
	if _, ok := store.ValidateToken("12345678901234567890123456789013"); ok {
		t.Fatal("expected unmatched token to be rejected")
	}
}

func TestTokenStoreAuthRequiredFailsWithoutTokens(t *testing.T) {
	envKey := "TEST_EMPTY_ENV"
	os.Setenv(envKey, "")
	defer os.Unsetenv(envKey)

	_, err := NewTokenStore(true, envKey)
	if err == nil {
		t.Fatal("expected error when authRequired=true and no tokens present")
	}

	store, err := NewTokenStore(false, envKey)
	if err != nil {
		t.Fatalf("expected no error when authRequired=false: %v", err)
	}
	if store.IsAuthRequired() {
		t.Fatal("expected authRequired to be false")
	}
}

func TestTokenStoreFallsBackToConfigTokens(t *testing.T) {
	envKey := "TEST_CONFIG_TOKEN_ENV"
	t.Setenv(envKey, "")
	configured := "config-token-12345678901234567890"
	store, err := NewTokenStoreWithConfig(true, envKey, []string{configured})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := store.ValidateToken(configured); !ok {
		t.Fatal("expected config.yaml token to be accepted")
	}
	environment := "environment-token-1234567890123456"
	t.Setenv(envKey, environment)
	store, err = NewTokenStoreWithConfig(true, envKey, []string{configured})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := store.ValidateToken(environment); !ok {
		t.Fatal("expected environment token to override config tokens")
	}
	if _, ok := store.ValidateToken(configured); ok {
		t.Fatal("config token must not remain active when environment override is set")
	}
}

func TestRateLimiter(t *testing.T) {
	limiter := NewRateLimiter(60, 2, 10) // 60 rpm = 1 req/s, burst 2
	pid := "test-principal"

	// 第一次和第二次应该成功（突发为 2）
	if ok, _ := limiter.Allow(pid); !ok {
		t.Fatal("expected first request to be allowed")
	}
	if ok, _ := limiter.Allow(pid); !ok {
		t.Fatal("expected second request to be allowed")
	}

	// 第三次应该被限流
	ok, retryAfter := limiter.Allow(pid)
	if ok {
		t.Fatal("expected third request to be rate limited")
	}
	if retryAfter <= 0 {
		t.Fatalf("expected positive retryAfter, got %d", retryAfter)
	}
}

func TestDailyQuota(t *testing.T) {
	quota := NewDailyQuotaTracker(2)
	pid := "user-1"

	if !quota.CheckAndDeduct(pid) {
		t.Fatal("first quota check should pass")
	}
	if !quota.CheckAndDeduct(pid) {
		t.Fatal("second quota check should pass")
	}
	if quota.CheckAndDeduct(pid) {
		t.Fatal("third quota check should fail because limit is 2")
	}

	// 另一个用户独立计算
	if !quota.CheckAndDeduct("user-2") {
		t.Fatal("user-2 quota should pass")
	}
}

func TestConcurrencyManager(t *testing.T) {
	cm := NewConcurrencyManager(2, 1) // global 2, perPrincipal 1

	// user1 acquire
	release1, ok := cm.Acquire("user1")
	if !ok {
		t.Fatal("user1 first acquire should succeed")
	}

	// user1 acquire again (should fail perPrincipal limit)
	_, ok = cm.Acquire("user1")
	if ok {
		t.Fatal("user1 second acquire should fail due to perPrincipal limit")
	}

	// user2 acquire (should succeed because global is 2)
	release2, ok := cm.Acquire("user2")
	if !ok {
		t.Fatal("user2 acquire should succeed")
	}

	// user3 acquire (should fail due to global limit)
	_, ok = cm.Acquire("user3")
	if ok {
		t.Fatal("user3 acquire should fail due to global limit")
	}

	// release user1
	release1()

	// user3 can now acquire
	release3, ok := cm.Acquire("user3")
	if !ok {
		t.Fatal("user3 acquire should succeed after user1 release")
	}

	release2()
	release3()
}

func TestCloudBudgetTrackerEnforcesPrincipalAndGlobalLimits(t *testing.T) {
	tracker := NewCloudBudgetTracker(3, 2)
	if !tracker.CheckAndDeduct("user-1") || !tracker.CheckAndDeduct("user-1") {
		t.Fatal("user-1 should consume its two daily cloud requests")
	}
	if tracker.CheckAndDeduct("user-1") {
		t.Fatal("user-1 should be blocked by the per-principal cloud budget")
	}
	if !tracker.CheckAndDeduct("user-2") {
		t.Fatal("user-2 should consume the remaining global request")
	}
	if tracker.CheckAndDeduct("user-3") {
		t.Fatal("global cloud budget should block additional requests")
	}
}
