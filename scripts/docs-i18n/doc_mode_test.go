package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func writeDocModeOutput(t *testing.T, sourceHash string, workflow int, provider string, model string) string {
	t.Helper()
	outputPath := filepath.Join(t.TempDir(), "index.md")
	content := `---
x-i18n:
  source_path: index.md
  source_hash: ` + sourceHash + `
  provider: ` + provider + `
  model: ` + model + `
  workflow: ` + fmt.Sprint(workflow) + `
---

body`
	if err := os.WriteFile(outputPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write output: %v", err)
	}
	return outputPath
}

func TestShouldSkipDocRequiresMatchingWorkflowProviderAndModel(t *testing.T) {
	sourceHash := "abc123"
	outputPath := writeDocModeOutput(t, sourceHash, 15, docsPiProviderOpenAI, defaultOpenAIModel)

	skip, err := shouldSkipDoc(outputPath, sourceHash)
	if err != nil {
		t.Fatalf("shouldSkipDoc failed: %v", err)
	}
	if skip {
		t.Fatal("expected workflow mismatch to force regeneration")
	}
}

func TestShouldSkipDocReturnsTrueWhenMetadataMatches(t *testing.T) {
	sourceHash := "abc123"
	outputPath := writeDocModeOutput(t, sourceHash, workflowVersion, docsPiProviderOpenAI, defaultOpenAIModel)

	skip, err := shouldSkipDoc(outputPath, sourceHash)
	if err != nil {
		t.Fatalf("shouldSkipDoc failed: %v", err)
	}
	if !skip {
		t.Fatal("expected matching metadata to skip regeneration")
	}
}

func TestShouldSkipDocRequiresMatchingProvider(t *testing.T) {
	sourceHash := "abc123"
	outputPath := writeDocModeOutput(t, sourceHash, workflowVersion, docsPiProviderAnthropic, defaultAnthropicModel)

	skip, err := shouldSkipDoc(outputPath, sourceHash)
	if err != nil {
		t.Fatalf("shouldSkipDoc failed: %v", err)
	}
	if skip {
		t.Fatal("expected provider mismatch to force regeneration")
	}
}
