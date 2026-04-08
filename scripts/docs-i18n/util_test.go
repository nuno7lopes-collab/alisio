package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDocsPiProviderPrefersExplicitOverride(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "anthropic")
	t.Setenv("OPENAI_API_KEY", "openai-key")
	t.Setenv("ANTHROPIC_API_KEY", "anthropic-key")

	if got := docsPiProvider(); got != "anthropic" {
		t.Fatalf("expected anthropic override, got %q", got)
	}
}

func TestDocsPiProviderPrefersOpenAIEnvWhenAvailable(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "")
	t.Setenv("OPENAI_API_KEY", "openai-key")
	t.Setenv("ANTHROPIC_API_KEY", "anthropic-key")

	if got := docsPiProvider(); got != "openai" {
		t.Fatalf("expected openai provider, got %q", got)
	}
}

func TestDocsPiModelUsesProviderDefault(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "anthropic")
	t.Setenv(envDocsI18nModel, "")

	if got := docsPiModel(); got != defaultAnthropicModel {
		t.Fatalf("expected anthropic default model, got %q", got)
	}
}

func TestDocsPiModelKeepsOpenAIDefaultAtGPT54(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "openai")
	t.Setenv(envDocsI18nModel, "")

	if got := docsPiModel(); got != defaultOpenAIModel {
		t.Fatalf("expected OpenAI default model %q, got %q", defaultOpenAIModel, got)
	}
}

func TestDocsPiModelPrefersExplicitOverride(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "openai")
	t.Setenv(envDocsI18nModel, "gpt-5.2")

	if got := docsPiModel(); got != "gpt-5.2" {
		t.Fatalf("expected explicit model override, got %q", got)
	}
}

func TestDocsPiProviderUsesOpenAICodexAuthFileWhenNoEnvKeys(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv(envDocsI18nProvider, "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")

	authDir := filepath.Join(tempHome, ".pi", "agent")
	if err := os.MkdirAll(authDir, 0o755); err != nil {
		t.Fatalf("mkdir auth dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(authDir, "auth.json"),
		[]byte(`{"openai-codex":{"type":"oauth"}}`),
		0o600,
	); err != nil {
		t.Fatalf("write auth file: %v", err)
	}

	if got := docsPiProvider(); got != docsPiProviderOpenAICodex {
		t.Fatalf("expected openai-codex provider, got %q", got)
	}
}

func TestEnsureDocsPiCredentialsAvailableExplainsFallbackOptions(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(envDocsI18nProvider, "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")

	err := ensureDocsPiCredentialsAvailable()
	if err == nil {
		t.Fatal("expected missing credentials error")
	}

	message := err.Error()
	for _, expected := range []string{
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"~/.pi/agent/auth.json",
		"`pi` + `/login`",
		envDocsI18nProvider,
	} {
		if !strings.Contains(message, expected) {
			t.Fatalf("expected %q in error message, got %q", expected, message)
		}
	}
}
