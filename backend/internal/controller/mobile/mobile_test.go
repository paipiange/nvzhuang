package mobile_test

import (
	"context"
	"testing"

	"backend/internal/logic/catalog"
	"backend/internal/logic/jobs"
)

func TestCatalogLogic(t *testing.T) {
	ctx := context.Background()

	// 1. 测试获取分类
	cats := catalog.GetCategories(ctx)
	if len(cats) == 0 {
		t.Errorf("GetCategories returned empty list")
	}

	// 2. 测试分页获取服装
	res := catalog.GetGarments(ctx, "real", "spring", "", 1, 10)
	if res.Page != 1 || res.PageSize != 10 {
		t.Errorf("Page info mismatch: got page %d, pageSize %d", res.Page, res.PageSize)
	}

	// 3. 测试根据 ID 获取详情
	if len(res.List) > 0 {
		first := res.List[0]
		detail, ok := catalog.GetGarmentByID(ctx, first.ID)
		if !ok || detail == nil || detail.ID != first.ID {
			t.Errorf("GetGarmentByID failed for ID %s", first.ID)
		}
	}

	// 4. 测试模特人像
	models := catalog.GetModels(ctx, "", 1, 5)
	if models.Page != 1 {
		t.Errorf("Models page mismatch: %d", models.Page)
	}
}

func TestJobsLogic(t *testing.T) {
	// 1. 测试临时文件上传与提取
	testData := []byte("fake-image-binary-data")
	fileID, err := jobs.SaveUploadedFile(testData, "image/jpeg")
	if err != nil {
		t.Fatalf("SaveUploadedFile failed: %v", err)
	}
	if fileID == "" {
		t.Fatalf("SaveUploadedFile returned empty fileID")
	}

	retrieved, mime, ok := jobs.GetUploadedFile(fileID)
	if !ok || string(retrieved) != string(testData) || mime != "image/jpeg" {
		t.Errorf("GetUploadedFile mismatch")
	}

	// 2. 测试任务创建与查询
	job := jobs.CreateJob("real:SPR-0001", "", fileID, "", "", "gemini", "1024x1536", true)
	if job.ID == "" || job.Status != "queued" {
		t.Errorf("CreateJob returned unexpected job: %+v", job)
	}

	found, ok := jobs.GetJob(job.ID)
	if !ok || found.ID != job.ID {
		t.Errorf("GetJob failed for ID %s", job.ID)
	}
}
