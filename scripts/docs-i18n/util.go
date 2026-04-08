package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	// Bump when prompt/glossary/auth-selection changes should invalidate cached translations.
	workflowVersion           = 16
	docsI18nEngineName        = "pi"
	envDocsI18nProvider       = "ALISIO_DOCS_I18N_PROVIDER"
	envDocsI18nModel          = "ALISIO_DOCS_I18N_MODEL"
	docsPiAuthFile            = ".pi/agent/auth.json"
	docsPiProviderAnthropic   = "anthropic"
	docsPiProviderOpenAI      = "openai"
	docsPiProviderOpenAICodex = "openai-codex"
	defaultOpenAIModel        = "gpt-5.4"
	defaultAnthropicModel     = "claude-opus-4-6"
	defaultFallbackProvider   = docsPiProviderOpenAI
	defaultFallbackModelName  = defaultOpenAIModel
)

func cacheNamespace() string {
	return fmt.Sprintf(
		"wf=%d|engine=%s|provider=%s|model=%s",
		workflowVersion,
		docsI18nEngineName,
		docsPiProvider(),
		docsPiModel(),
	)
}

func cacheKey(namespace, srcLang, tgtLang, segmentID, textHash string) string {
	raw := fmt.Sprintf("%s|%s|%s|%s|%s", namespace, srcLang, tgtLang, segmentID, textHash)
	hash := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(hash[:])
}

func hashText(text string) string {
	normalized := normalizeText(text)
	hash := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(hash[:])
}

func hashBytes(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func normalizeText(text string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
}

func docsPiProvider() string {
	if value := strings.TrimSpace(os.Getenv(envDocsI18nProvider)); value != "" {
		return value
	}
	if strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != "" {
		return docsPiProviderOpenAI
	}
	if strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")) != "" {
		return docsPiProviderAnthropic
	}
	switch {
	case docsPiAuthHas(docsPiProviderOpenAICodex):
		return docsPiProviderOpenAICodex
	case docsPiAuthHas(docsPiProviderAnthropic):
		return docsPiProviderAnthropic
	case docsPiAuthHas(docsPiProviderOpenAI):
		return docsPiProviderOpenAI
	}
	return defaultFallbackProvider
}

func docsPiModel() string {
	if value := strings.TrimSpace(os.Getenv(envDocsI18nModel)); value != "" {
		return value
	}
	switch docsPiProvider() {
	case docsPiProviderAnthropic:
		return defaultAnthropicModel
	case docsPiProviderOpenAI, docsPiProviderOpenAICodex:
		return defaultOpenAIModel
	default:
		return defaultFallbackModelName
	}
}

func docsPiAuthHas(provider string) bool {
	if strings.TrimSpace(provider) == "" {
		return false
	}
	providers := loadDocsPiAuthProviders()
	_, ok := providers[provider]
	return ok
}

func loadDocsPiAuthProviders() map[string]struct{} {
	homeDir, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(homeDir) == "" {
		return map[string]struct{}{}
	}
	authPath := filepath.Join(homeDir, docsPiAuthFile)
	data, err := os.ReadFile(authPath)
	if err != nil {
		return map[string]struct{}{}
	}

	var auth map[string]json.RawMessage
	if err := json.Unmarshal(data, &auth); err != nil {
		return map[string]struct{}{}
	}

	providers := make(map[string]struct{}, len(auth))
	for provider, raw := range auth {
		name := strings.TrimSpace(provider)
		if name == "" {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(string(raw)), "null") {
			continue
		}
		providers[name] = struct{}{}
	}
	return providers
}

func docsPiHasCredentialsForProvider(provider string) bool {
	switch strings.TrimSpace(provider) {
	case docsPiProviderOpenAI:
		return strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != "" || docsPiAuthHas(docsPiProviderOpenAI)
	case docsPiProviderOpenAICodex:
		return strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != "" ||
			docsPiAuthHas(docsPiProviderOpenAICodex) ||
			docsPiAuthHas(docsPiProviderOpenAI)
	case docsPiProviderAnthropic:
		return strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")) != "" || docsPiAuthHas(docsPiProviderAnthropic)
	default:
		return true
	}
}

func ensureDocsPiCredentialsAvailable() error {
	provider := docsPiProvider()
	if docsPiHasCredentialsForProvider(provider) {
		return nil
	}
	authPath := filepath.Join("~", docsPiAuthFile)
	switch provider {
	case docsPiProviderOpenAI:
		return fmt.Errorf(
			"docs-i18n: no credentials found for provider %q. Set OPENAI_API_KEY, set ANTHROPIC_API_KEY to switch providers automatically, or create %s via `pi` + `/login` (for ChatGPT Plus/Pro use provider %q). You can also override provider selection with %s.",
			provider,
			authPath,
			docsPiProviderOpenAICodex,
			envDocsI18nProvider,
		)
	case docsPiProviderOpenAICodex:
		return fmt.Errorf(
			"docs-i18n: no credentials found for provider %q. Set OPENAI_API_KEY, or create %s via `pi` + `/login` using provider %q. To switch providers, set %s=%q and provide ANTHROPIC_API_KEY.",
			provider,
			authPath,
			docsPiProviderOpenAICodex,
			envDocsI18nProvider,
			docsPiProviderAnthropic,
		)
	case docsPiProviderAnthropic:
		return fmt.Errorf(
			"docs-i18n: no credentials found for provider %q. Set ANTHROPIC_API_KEY, or create %s via `pi` + `/login`. To switch providers, set %s=%q or %s=%q.",
			provider,
			authPath,
			envDocsI18nProvider,
			docsPiProviderOpenAI,
			envDocsI18nProvider,
			docsPiProviderOpenAICodex,
		)
	default:
		return nil
	}
}

func segmentID(relPath, textHash string) string {
	shortHash := textHash
	if len(shortHash) > 16 {
		shortHash = shortHash[:16]
	}
	return fmt.Sprintf("%s:%s", relPath, shortHash)
}

func splitWhitespace(text string) (string, string, string) {
	if text == "" {
		return "", "", ""
	}
	start := 0
	for start < len(text) && isWhitespace(text[start]) {
		start++
	}
	end := len(text)
	for end > start && isWhitespace(text[end-1]) {
		end--
	}
	return text[:start], text[start:end], text[end:]
}

func isWhitespace(b byte) bool {
	switch b {
	case ' ', '\t', '\n', '\r':
		return true
	default:
		return false
	}
}

func fatal(err error) {
	if err == nil {
		return
	}
	_, _ = io.WriteString(os.Stderr, err.Error()+"\n")
	os.Exit(1)
}
