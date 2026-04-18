#!/bin/bash

# VibeTunnel Logging Utility
# Simplifies access to VibeTunnel logs using macOS unified logging system

set -euo pipefail

# Configuration
SUBSYSTEM="ai.alisio"
DEFAULT_LEVEL="info"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to handle sudo password errors
handle_sudo_error() {
    echo -e "\n${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️  Password Required for Log Access${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    echo -e "alisio-log needs to use sudo to show complete log data (Apple hides sensitive info by default)."
    echo -e "\nTo avoid password prompts, configure passwordless sudo for the log command:"
    echo -e "See: ${BLUE}apple/docs/logging-private-fix.md${NC}\n"
    echo -e "Quick fix:"
    echo -e "  1. Run: ${GREEN}sudo visudo${NC}"
    echo -e "  2. Add: ${GREEN}$(whoami) ALL=(ALL) NOPASSWD: /usr/bin/log${NC}"
    echo -e "  3. Save and exit (:wq)\n"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    exit 1
}

# Default values
STREAM_MODE=false
TIME_RANGE="5m"  # Default to last 5 minutes
CATEGORY=""
LOG_LEVEL="$DEFAULT_LEVEL"
SEARCH_TEXT=""
OUTPUT_FILE=""
ERRORS_ONLY=false
SERVER_ONLY=false
TAIL_LINES=50  # Default number of lines to show
SHOW_TAIL=true
SHOW_HELP=false
STYLE_JSON=false

# Function to show usage
show_usage() {
    cat << EOF
alisio-log - Alisio Logging Utility

USAGE:
    alisio-log [OPTIONS]

DESCRIPTION:
    View Alisio logs with full details (bypasses Apple's privacy redaction).
    Requires sudo access configured for /usr/bin/log command.

LOG FLOW ARCHITECTURE:
    Alisio logs flow through the macOS unified log (subsystem: ai.alisio).

LOG CATEGORIES (examples):
    • voicewake           - Voice wake detection/test harness
    • gateway             - Gateway process manager
    • xpc                 - XPC service calls
    • notifications       - Notification helper
    • screenshot          - Screenshotter
    • shell               - ShellExecutor

QUICK START:
    alisio-log -n 100             Show last 100 lines from all components
    alisio-log -f                 Follow logs in real-time
    alisio-log -e                 Show only errors
    alisio-log -c ServerManager   Show logs from ServerManager only

OPTIONS:
    -h, --help              Show this help message
    -f, --follow            Stream logs continuously (like tail -f)
    -n, --lines NUM         Number of lines to show (default: 50)
    -l, --last TIME         Time range to search (default: 5m)
                           Examples: 5m, 1h, 2d, 1w
    -c, --category CAT      Filter by category (e.g., ServerManager, SessionService)
    -e, --errors            Show only error messages
    -d, --debug             Show debug level logs (more verbose)
    -s, --search TEXT       Search for specific text in log messages
    -o, --output FILE       Export logs to file
    --server                Show only server output logs
    --all                   Show all logs without tail limit
    --list-categories       List all available log categories
    --json                  Output in JSON format

EXAMPLES:
    alisio-log                   Show last 50 lines from past 5 minutes (default)
    alisio-log -f                Stream logs continuously
    alisio-log -n 100            Show last 100 lines
    alisio-log -e                Show only recent errors
    alisio-log -l 30m -n 200     Show last 200 lines from past 30 minutes
    alisio-log -c ServerManager  Show recent ServerManager logs
    alisio-log -s "fail"         Search for "fail" in recent logs
    alisio-log --server -e       Show recent server errors
    alisio-log -f -d             Stream debug logs continuously

CATEGORIES:
    Common categories include:
    - ServerManager         - Server lifecycle and configuration
    - SessionService        - Terminal session management
    - TerminalManager       - Terminal spawning and control
    - GitRepository         - Git integration features
    - ScreencapService      - Screen capture functionality
    - WebRTCManager         - WebRTC connections
    - UnixSocket           - Unix socket communication
    - WindowTracker        - Window tracking and focus
    - NgrokService         - Ngrok tunnel management
    - ServerOutput         - Node.js server output

TIME FORMATS:
    - 5m  = 5 minutes       - 1h  = 1 hour
    - 2d  = 2 days         - 1w  = 1 week

EOF
}

# Function to list categories
list_categories() {
    echo -e "${BLUE}Fetching VibeTunnel log categories from the last hour...${NC}\n"

    # Get unique categories from recent logs
    log show --predicate "subsystem == \"$SUBSYSTEM\"" --last 1h 2>/dev/null | \
        grep -E "category: \"[^\"]+\"" | \
        sed -E 's/.*category: "([^"]+)".*/\1/' | \
        sort | uniq | \
        while read -r cat; do
            echo "  • $cat"
        done

    echo -e "\n${YELLOW}Note: Only categories with recent activity are shown${NC}"
}

# Escape user input embedded in macOS log predicate string literals.
escape_predicate_literal() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '%s' "$value"
}

# Show help if no arguments provided
if [[ $# -eq 0 ]]; then
    show_usage
    exit 0
fi

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -f|--follow)
            STREAM_MODE=true
            SHOW_TAIL=false
            shift
            ;;
        -n|--lines)
            TAIL_LINES="$2"
            shift 2
            ;;
        -l|--last)
            TIME_RANGE="$2"
            shift 2
            ;;
        -c|--category)
            CATEGORY="$2"
            shift 2
            ;;
        -e|--errors)
            ERRORS_ONLY=true
            shift
            ;;
        -d|--debug)
            LOG_LEVEL="debug"
            shift
            ;;
        -s|--search)
            SEARCH_TEXT="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --server)
            SERVER_ONLY=true
            CATEGORY="ServerOutput"
            shift
            ;;
        --list-categories)
            list_categories
            exit 0
            ;;
        --json)
            STYLE_JSON=true
            shift
            ;;
        --all)
            SHOW_TAIL=false
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Build the predicate
PREDICATE="subsystem == \"$SUBSYSTEM\""

# Add category filter if specified
if [[ -n "$CATEGORY" ]]; then
    ESCAPED_CATEGORY=$(escape_predicate_literal "$CATEGORY")
    PREDICATE="$PREDICATE AND category == \"$ESCAPED_CATEGORY\""
fi

# Add error filter if specified
if [[ "$ERRORS_ONLY" == true ]]; then
    PREDICATE="$PREDICATE AND (eventType == \"error\" OR messageType == \"error\" OR eventMessage CONTAINS \"ERROR\" OR eventMessage CONTAINS \"[31m\")"
fi

# Add search filter if specified
if [[ -n "$SEARCH_TEXT" ]]; then
    ESCAPED_SEARCH_TEXT=$(escape_predicate_literal "$SEARCH_TEXT")
    PREDICATE="$PREDICATE AND eventMessage CONTAINS[c] \"$ESCAPED_SEARCH_TEXT\""
fi

# Build the command as argv array to avoid shell eval injection
LOG_CMD=(sudo log)
if [[ "$STREAM_MODE" == true ]]; then
    # Streaming mode
    LOG_CMD+=(stream --predicate "$PREDICATE" --level "$LOG_LEVEL" --info)

    echo -e "${GREEN}Streaming VibeTunnel logs continuously...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop${NC}\n"
else
    # Show mode
    LOG_CMD+=(show --predicate "$PREDICATE")

    # Add log level for show command
    if [[ "$LOG_LEVEL" == "debug" ]]; then
        LOG_CMD+=(--debug)
    else
        LOG_CMD+=(--info)
    fi

    # Add time range
    LOG_CMD+=(--last "$TIME_RANGE")
fi

# Add JSON style if requested
if [[ "$STYLE_JSON" == true ]]; then
    LOG_CMD+=(--style json)
fi

# Execute the command safely and handle auth failures.
run_and_maybe_tail() {
    local tmp_error="/tmp/alisio-log-error"
    : > "$tmp_error"

    if [[ -n "$OUTPUT_FILE" ]]; then
        if ! "${LOG_CMD[@]}" >"$OUTPUT_FILE" 2>"$tmp_error"; then
            if grep -q "a password is required\|password is required\|Authentication failed" "$tmp_error" 2>/dev/null; then
                handle_sudo_error
            fi
            cat "$tmp_error"
            exit 1
        fi
        echo -e "${GREEN}Logs exported to: $OUTPUT_FILE${NC}"
        return
    fi

    if [[ "$SHOW_TAIL" == true && "$STREAM_MODE" == false ]]; then
        if ! "${LOG_CMD[@]}" 2>"$tmp_error" | tail -n "$TAIL_LINES"; then
            if grep -q "a password is required\|password is required\|Authentication failed" "$tmp_error" 2>/dev/null; then
                handle_sudo_error
            fi
            cat "$tmp_error"
            exit 1
        fi
        return
    fi

    if ! "${LOG_CMD[@]}" 2>"$tmp_error"; then
        if grep -q "a password is required\|password is required\|Authentication failed" "$tmp_error" 2>/dev/null; then
            handle_sudo_error
        fi
        cat "$tmp_error"
        exit 1
    fi
}

run_and_maybe_tail
