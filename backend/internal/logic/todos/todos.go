package todos

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/frame/g"
)

type Item struct {
	ID        int64  `json:"id"`
	Code      string `json:"code"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
	Sort      int    `json:"sort" orm:"sort_no"`
}

type Summary struct {
	Items     []Item `json:"items"`
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
	Progress  int    `json:"progress"`
}

var (
	mu     sync.RWMutex
	memory = []Item{
		{ID: 1, Code: "progress-ui", Title: "完成语音状态面板、TODO 勾选和进度汇总", Completed: true, Sort: 5},
		{ID: 2, Code: "models", Title: "下载并校验 Qwen、FunASR、CosyVoice 模型", Sort: 10},
		{ID: 3, Code: "services", Title: "启动本地 Qwen、FunASR、CosyVoice 服务", Sort: 20},
		{ID: 4, Code: "backend", Title: "完成 GoFrame 语音 WebSocket 接入", Completed: true, Sort: 30},
		{ID: 5, Code: "client", Title: "完成 UniApp 录音、字幕、播放和打断", Completed: true, Sort: 40},
		{ID: 6, Code: "verify", Title: "断网验证并检查隐私与缓存路径", Sort: 50},
	}
)

func dbOrNil() gdb.DB {
	db, err := gdb.Instance()
	if err != nil {
		return nil
	}
	return db
}

func EnsureTable(ctx context.Context) {
	db := dbOrNil()
	if db == nil {
		return
	}
	_, _ = db.Exec(ctx, `CREATE TABLE IF NOT EXISTS todolist (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        code VARCHAR(64) NOT NULL UNIQUE,
        title VARCHAR(255) NOT NULL,
        completed TINYINT(1) NOT NULL DEFAULT 0,
        sort_no INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	for _, item := range memory {
		_, _ = db.Exec(ctx, `INSERT IGNORE INTO todolist(code,title,completed,sort_no,created_at,updated_at) VALUES(?,?,?,?,?,?)`, item.Code, item.Title, item.Completed, item.Sort, time.Now(), time.Now())
	}
}

func localPath(ctx context.Context) string {
	root := "D:/ai/ai/nvzhuang"
	if configured, err := g.Cfg().Get(ctx, "voice.root"); err == nil && !configured.IsEmpty() {
		root = configured.String()
	}
	return filepath.Join(root, "data", "voice-todos.json")
}

type completionState bool

func (state *completionState) UnmarshalJSON(data []byte) error {
	switch string(data) {
	case "true":
		*state = true
	case "false":
		*state = false
	default:
		return errors.New("todo completion must be a boolean")
	}
	return nil
}

func readLocal(filename string) ([]Item, error) {
	rows := append([]Item(nil), memory...)
	file, err := os.Open(filename)
	if errors.Is(err, os.ErrNotExist) {
		return rows, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 64*1024+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 64*1024 {
		return nil, errors.New("todo state exceeds size limit")
	}
	var states map[string]completionState
	if err := json.Unmarshal(data, &states); err != nil || states == nil {
		return nil, errors.New("invalid todo state")
	}
	for i := range rows {
		if completed, ok := states[rows[i].Code]; ok {
			rows[i].Completed = bool(completed)
		}
	}
	return rows, nil
}

func writeLocal(filename string, rows []Item) error {
	states := make(map[string]bool, len(rows))
	for _, item := range rows {
		states[item.Code] = item.Completed
	}
	data, err := json.Marshal(states)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(filename), ".voice-todos-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), filename)
}

func SummaryFor(ctx context.Context) (Summary, error) {
	if db := dbOrNil(); db != nil {
		var rows []Item
		if err := db.Model("todolist").Ctx(ctx).OrderAsc("sort_no").Scan(&rows); err != nil {
			return Summary{}, err
		}
		return summarize(rows), nil
	}
	mu.RLock()
	defer mu.RUnlock()
	rows, err := readLocal(localPath(ctx))
	return summarize(rows), err
}

func SetCompleted(ctx context.Context, id int64, completed bool) (Summary, bool, error) {
	if id <= 0 {
		return Summary{}, false, nil
	}
	if db := dbOrNil(); db != nil {
		if _, err := db.Model("todolist").Ctx(ctx).Where("id", id).Update(g.Map{"completed": completed, "updated_at": time.Now()}); err != nil {
			return Summary{}, false, err
		}
		summary, err := SummaryFor(ctx)
		for _, item := range summary.Items {
			if item.ID == id {
				return summary, true, err
			}
		}
		return summary, false, err
	}
	// shortcut: one backend process owns this file; use the database for multiple writers.
	mu.Lock()
	defer mu.Unlock()
	filename := localPath(ctx)
	rows, err := readLocal(filename)
	if err != nil {
		return Summary{}, false, err
	}
	for i := range rows {
		if rows[i].ID == id {
			rows[i].Completed = completed
			if err := writeLocal(filename, rows); err != nil {
				return Summary{}, false, err
			}
			return summarize(rows), true, nil
		}
	}
	return summarize(rows), false, nil
}

func summarize(items []Item) Summary {
	completed := 0
	for _, item := range items {
		if item.Completed {
			completed++
		}
	}
	progress := 0
	if len(items) > 0 {
		progress = completed * 100 / len(items)
	}
	return Summary{Items: items, Completed: completed, Total: len(items), Progress: progress}
}
