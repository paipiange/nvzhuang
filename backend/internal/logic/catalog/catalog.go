package catalog

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gfile"
)

type Garment struct {
	ID           string   `json:"id"`
	OriginalID   string   `json:"original_id"`
	Library      string   `json:"library"`
	Category     string   `json:"category"`
	Title        string   `json:"title"`
	Keywords     []string `json:"keywords"`
	ThumbnailURL string   `json:"thumbnail_url"`
	ImageURL     string   `json:"image_url"`
	OriginalURL  string   `json:"original_url,omitempty"`
}

type CategoryItem struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type ModelPortrait struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	ThumbnailURL string   `json:"thumbnail_url"`
	ImageURL     string   `json:"image_url"`
	OriginalURL  string   `json:"original_url,omitempty"`
	Hairstyle    string   `json:"hairstyle,omitempty"`
	Tags         []string `json:"tags"`
}

type PageResult[T any] struct {
	List     []T  `json:"list"`
	Page     int  `json:"page"`
	PageSize int  `json:"page_size"`
	Total    int  `json:"total"`
	HasMore  bool `json:"has_more"`
}

type CatalogRaw struct {
	Meta struct {
		TotalGarments  int    `json:"total_garments"`
		RealCount      int    `json:"real_count"`
		AnimeCount     int    `json:"anime_count"`
		PortraitsCount int    `json:"portraits_count"`
		UpdatedAt      string `json:"updated_at"`
	} `json:"meta"`
	Categories []CategoryItem  `json:"categories"`
	Garments   []Garment       `json:"garments"`
	Portraits  []ModelPortrait `json:"portraits"`
}

var (
	once        sync.Once
	catalogData *CatalogRaw
	garmentMap  map[string]*Garment
	portraitMap map[string]*ModelPortrait
)

func initCatalog(ctx context.Context) {
	once.Do(func() {
		garmentMap = make(map[string]*Garment)
		portraitMap = make(map[string]*ModelPortrait)
		catalogData = &CatalogRaw{}

		candidates := []string{
			"internal/logic/catalog/data/catalog.json",
			"backend/internal/logic/catalog/data/catalog.json",
			"../backend/internal/logic/catalog/data/catalog.json",
			"../../logic/catalog/data/catalog.json",
			"catalog.json",
		}

		var targetPath string
		for _, p := range candidates {
			if gfile.Exists(p) {
				targetPath = p
				break
			}
		}

		if targetPath == "" {
			g.Log().Warning(ctx, "未找到 catalog.json 数据文件，图集目录将为空")
			return
		}

		bytes, err := os.ReadFile(targetPath)
		if err != nil {
			g.Log().Errorf(ctx, "读取 catalog.json 失败: %v", err)
			return
		}

		if err := json.Unmarshal(bytes, catalogData); err != nil {
			g.Log().Errorf(ctx, "解析 catalog.json 失败: %v", err)
			return
		}

		for i := range catalogData.Garments {
			g := &catalogData.Garments[i]
			garmentMap[g.ID] = g
			garmentMap[g.OriginalID] = g
		}

		for i := range catalogData.Portraits {
			p := &catalogData.Portraits[i]
			portraitMap[p.ID] = p
			portraitMap["portrait:"+p.ID] = p
			portraitMap["real:"+p.ID] = p
		}

		g.Log().Infof(ctx, "已成功载入图库目录: %d 款服装, %d 位模特, %d 个分类",
			len(catalogData.Garments), len(catalogData.Portraits), len(catalogData.Categories))
	})
}

// GetCategories 获取分类列表与统计数量
func GetCategories(ctx context.Context) []CategoryItem {
	initCatalog(ctx)
	if catalogData == nil || len(catalogData.Categories) == 0 {
		return []CategoryItem{
			{ID: "all", Name: "全部", Count: 0},
			{ID: "spring", Name: "春季甄选", Count: 0},
			{ID: "summer", Name: "清凉夏日", Count: 0},
			{ID: "autumn", Name: "温柔秋意", Count: 0},
			{ID: "winter", Name: "暖冬质感", Count: 0},
		}
	}
	return catalogData.Categories
}

// GetGarments 分页查询服装列表
func GetGarments(ctx context.Context, library, category, q string, page, pageSize int) PageResult[Garment] {
	initCatalog(ctx)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	if catalogData == nil || len(catalogData.Garments) == 0 {
		return PageResult[Garment]{
			List:     []Garment{},
			Page:     page,
			PageSize: pageSize,
			Total:    0,
			HasMore:  false,
		}
	}

	var filtered []Garment
	query := strings.TrimSpace(strings.ToLower(q))

	for _, g := range catalogData.Garments {
		if library != "" && g.Library != library {
			continue
		}
		if category != "" && category != "all" && g.Category != category {
			continue
		}
		if query != "" {
			matched := strings.Contains(strings.ToLower(g.Title), query) ||
				strings.Contains(strings.ToLower(g.OriginalID), query)
			if !matched {
				for _, kw := range g.Keywords {
					if strings.Contains(strings.ToLower(kw), query) {
						matched = true
						break
					}
				}
			}
			if !matched {
				continue
			}
		}
		filtered = append(filtered, g)
	}

	total := len(filtered)
	start := (page - 1) * pageSize
	if start >= total {
		return PageResult[Garment]{
			List:     []Garment{},
			Page:     page,
			PageSize: pageSize,
			Total:    total,
			HasMore:  false,
		}
	}

	end := start + pageSize
	if end > total {
		end = total
	}

	return PageResult[Garment]{
		List:     filtered[start:end],
		Page:     page,
		PageSize: pageSize,
		Total:    total,
		HasMore:  end < total,
	}
}

// GetGarmentByID 根据 ID 获取单件服装详情
func GetGarmentByID(ctx context.Context, id string) (*Garment, bool) {
	initCatalog(ctx)
	g, ok := garmentMap[id]
	return g, ok
}

// GetModels 分页查询模特人像列表
func GetModels(ctx context.Context, hairstyle string, page, pageSize int) PageResult[ModelPortrait] {
	initCatalog(ctx)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	if catalogData == nil || len(catalogData.Portraits) == 0 {
		return PageResult[ModelPortrait]{
			List:     []ModelPortrait{},
			Page:     page,
			PageSize: pageSize,
			Total:    0,
			HasMore:  false,
		}
	}

	var filtered []ModelPortrait
	hs := strings.TrimSpace(hairstyle)

	for _, p := range catalogData.Portraits {
		if hs != "" && hs != "全部" && !strings.Contains(p.Hairstyle, hs) {
			continue
		}
		filtered = append(filtered, p)
	}

	total := len(filtered)
	start := (page - 1) * pageSize
	if start >= total {
		return PageResult[ModelPortrait]{
			List:     []ModelPortrait{},
			Page:     page,
			PageSize: pageSize,
			Total:    total,
			HasMore:  false,
		}
	}

	end := start + pageSize
	if end > total {
		end = total
	}

	return PageResult[ModelPortrait]{
		List:     filtered[start:end],
		Page:     page,
		PageSize: pageSize,
		Total:    total,
		HasMore:  end < total,
	}
}

// GetModelByID 根据 ID 获取模特人像详情
func GetModelByID(ctx context.Context, id string) (*ModelPortrait, bool) {
	initCatalog(ctx)
	p, ok := portraitMap[id]
	return p, ok
}
