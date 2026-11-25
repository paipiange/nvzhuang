package security

import (
	"sync"
	"time"
)

type CloudBudgetTracker struct {
	mu                sync.Mutex
	globalLimit       int
	perPrincipalLimit int
	globalUsage       map[string]int
	principalUsage    map[string]int
	lastCleanup       time.Time
}

func NewCloudBudgetTracker(globalLimit, perPrincipalLimit int) *CloudBudgetTracker {
	if globalLimit <= 0 {
		globalLimit = 100
	}
	if perPrincipalLimit <= 0 {
		perPrincipalLimit = 20
	}
	return &CloudBudgetTracker{
		globalLimit:       globalLimit,
		perPrincipalLimit: perPrincipalLimit,
		globalUsage:       make(map[string]int),
		principalUsage:    make(map[string]int),
		lastCleanup:       time.Now().UTC(),
	}
}

func (t *CloudBudgetTracker) CheckAndDeduct(principalID string) bool {
	if principalID == "" {
		principalID = "anonymous"
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	if now.Sub(t.lastCleanup) > 12*time.Hour {
		t.cleanupLocked(today)
		t.lastCleanup = now
	}
	principalKey := principalID + ":" + today
	if t.globalUsage[today] >= t.globalLimit || t.principalUsage[principalKey] >= t.perPrincipalLimit {
		return false
	}
	t.globalUsage[today]++
	t.principalUsage[principalKey]++
	return true
}

func (t *CloudBudgetTracker) cleanupLocked(today string) {
	for day := range t.globalUsage {
		if day != today {
			delete(t.globalUsage, day)
		}
	}
	for key := range t.principalUsage {
		if len(key) < len(today) || key[len(key)-len(today):] != today {
			delete(t.principalUsage, key)
		}
	}
}
