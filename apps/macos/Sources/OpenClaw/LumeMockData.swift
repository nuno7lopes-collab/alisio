import AppKit
import Foundation

enum LumeIntegrationGroup: String, CaseIterable, Identifiable {
    case socialMedia = "Social Media"
    case googleWorkspace = "Google Workspace"
    case microsoft365 = "Microsoft 365"
    case productivity = "Productivity & Project Management"
    case fileStorage = "File Storage"
    case marketingAnalytics = "Marketing & Analytics"
    case development = "Development & Infrastructure"

    var id: String { self.rawValue }
}

struct LumeIntegration: Identifiable, Hashable {
    struct RequiredInput: Hashable {
        let placeholder: String
        let suffix: String?
    }

    let id: String
    let title: String
    let vendorLabel: String
    let mark: String
    let tintHex: UInt
    let group: LumeIntegrationGroup
    let description: String?
    let disclaimer: String?
    let requiredInput: RequiredInput?
    let externalURL: URL?
}

struct LumeFollowLink: Identifiable {
    let id: String
    let title: String
    let mark: String
    let url: URL
}

struct LumeProfileSummary {
    let fullName: String
    let username: String
    let email: String
    let planName: String
    let joinedLabel: String

    var initials: String {
        String(self.fullName.prefix(1)).uppercased()
    }
}

enum LumeMockData {
    static func currentProfile() -> LumeProfileSummary {
        let fullName = NSFullUserName().trimmingCharacters(in: .whitespacesAndNewlines)
        let username = NSUserName().trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedFullName = fullName.isEmpty ? "Local User" : fullName
        let resolvedUsername = username.isEmpty ? "local" : username

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateStyle = .medium

        return .init(
            fullName: resolvedFullName,
            username: resolvedUsername,
            email: "\(resolvedUsername)@lume.local",
            planName: "Free Plan",
            joinedLabel: formatter.string(from: Date()))
    }

    static let followLinks: [LumeFollowLink] = [
        .init(id: "x", title: "Twitter", mark: "X", url: URL(string: "https://x.com")!),
        .init(id: "linkedin", title: "LinkedIn", mark: "in", url: URL(string: "https://www.linkedin.com")!),
        .init(id: "reddit", title: "Reddit", mark: "R", url: URL(string: "https://www.reddit.com")!),
        .init(id: "discord", title: "Discord", mark: "D", url: URL(string: "https://discord.com")!),
    ]

    static let integrations: [LumeIntegration] = [
        .init(id: "facebook", title: "Facebook", vendorLabel: "Continue with Facebook", mark: "f", tintHex: 0x4A7BFF, group: .socialMedia, description: "Pages and business messaging surfaces.", disclaimer: "Business and creator surfaces only.", requiredInput: nil, externalURL: URL(string: "https://www.facebook.com/dialog/oauth")!),
        .init(id: "instagram", title: "Instagram", vendorLabel: "Connect with Instagram", mark: "ig", tintHex: 0xFF6B9A, group: .socialMedia, description: "Professional and creator account access.", disclaimer: "Business and creator surfaces only.", requiredInput: nil, externalURL: URL(string: "https://www.instagram.com/accounts/login/")!),
        .init(id: "whatsapp-business", title: "WhatsApp Business", vendorLabel: "Connect with Meta", mark: "WA", tintHex: 0x4BC76A, group: .socialMedia, description: "Business messaging and handoff surfaces.", disclaimer: "Best paired with a dedicated company number.", requiredInput: nil, externalURL: URL(string: "https://business.whatsapp.com/")!),
        .init(id: "telegram", title: "Telegram", vendorLabel: "Connect with Telegram", mark: "TG", tintHex: 0x57A5FF, group: .socialMedia, description: "Bot and channel access.", disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://my.telegram.org/apps")!),
        .init(id: "x-twitter", title: "X / Twitter", vendorLabel: "Connect with X", mark: "X", tintHex: 0xFFFFFF, group: .socialMedia, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developer.x.com/en/portal/dashboard")!),
        .init(id: "tiktok", title: "TikTok", vendorLabel: "Connect with TikTok", mark: "TT", tintHex: 0x2EE6D6, group: .socialMedia, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developers.tiktok.com/")!),
        .init(id: "linkedin", title: "LinkedIn", vendorLabel: "Connect with LinkedIn", mark: "in", tintHex: 0x3A7CFD, group: .socialMedia, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://www.linkedin.com/developers/")!),
        .init(id: "pinterest", title: "Pinterest", vendorLabel: "Connect with Pinterest", mark: "P", tintHex: 0xF26B8A, group: .socialMedia, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developers.pinterest.com/")!),
        .init(id: "reddit", title: "Reddit", vendorLabel: "Connect with Reddit", mark: "R", tintHex: 0xFF7A45, group: .socialMedia, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://www.reddit.com/prefs/apps")!),
        .init(id: "discord", title: "Discord", vendorLabel: "Connect with Discord", mark: "D", tintHex: 0x7888FF, group: .socialMedia, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://discord.com/developers/applications")!),

        .init(id: "google-slides", title: "Google Slides", vendorLabel: "Connect with Google", mark: "GS", tintHex: 0xF3BE6D, group: .googleWorkspace, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://myaccount.google.com/permissions")!),
        .init(id: "google-docs", title: "Google Docs", vendorLabel: "Connect with Google", mark: "G", tintHex: 0x6E91FF, group: .googleWorkspace, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://myaccount.google.com/permissions")!),
        .init(id: "google-sheets", title: "Google Sheets", vendorLabel: "Connect with Google", mark: "G", tintHex: 0x4CAF61, group: .googleWorkspace, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://myaccount.google.com/permissions")!),
        .init(id: "google-forms", title: "Google Forms", vendorLabel: "Connect with Google", mark: "G", tintHex: 0x9F7AEA, group: .googleWorkspace, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://myaccount.google.com/permissions")!),
        .init(id: "youtube", title: "YouTube", vendorLabel: "Connect with Google", mark: "YT", tintHex: 0xFF6A63, group: .googleWorkspace, description: nil, disclaimer: "Manage channel access through your Google security settings.", requiredInput: nil, externalURL: URL(string: "https://studio.youtube.com/")!),
        .init(id: "gmail-read", title: "Gmail Read", vendorLabel: "Connect with Google", mark: "M", tintHex: 0xF09B8C, group: .googleWorkspace, description: nil, disclaimer: "Read-only access for inbox triage and summaries.", requiredInput: nil, externalURL: URL(string: "https://myaccount.google.com/permissions")!),
        .init(id: "gmail-send", title: "Gmail Send Only", vendorLabel: "Connect with Google", mark: "M", tintHex: 0xF09B8C, group: .googleWorkspace, description: nil, disclaimer: "Send-only access for drafts and outbound replies.", requiredInput: nil, externalURL: URL(string: "https://myaccount.google.com/permissions")!),
        .init(id: "gmail-modify", title: "Gmail Modify", vendorLabel: "Connect with Google", mark: "M", tintHex: 0xF09B8C, group: .googleWorkspace, description: nil, disclaimer: "Manage labels and message state alongside reads.", requiredInput: nil, externalURL: URL(string: "https://myaccount.google.com/permissions")!),
        .init(id: "google-calendar", title: "Google Calendar", vendorLabel: "Connect with Google", mark: "31", tintHex: 0x7C98FF, group: .googleWorkspace, description: nil, disclaimer: "Scheduling and event creation for shared assistant flows.", requiredInput: nil, externalURL: URL(string: "https://calendar.google.com/")!),

        .init(id: "outlook", title: "Outlook", vendorLabel: "Connect with Outlook", mark: "O", tintHex: 0x7AA4FF, group: .microsoft365, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://account.live.com/consent/Manage")!),
        .init(id: "outlook-calendar", title: "Outlook Calendar", vendorLabel: "Connect with Outlook", mark: "OC", tintHex: 0x7AA4FF, group: .microsoft365, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://outlook.office.com/calendar/")!),

        .init(id: "slack", title: "Slack", vendorLabel: "Connect with Slack", mark: "S", tintHex: 0x8E5CFF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://api.slack.com/apps")!),
        .init(id: "fireflies", title: "Fireflies", vendorLabel: "Connect with Fireflies", mark: "F", tintHex: 0xD64ACD, group: .productivity, description: nil, disclaimer: "Meeting transcription and call intelligence.", requiredInput: nil, externalURL: URL(string: "https://app.fireflies.ai/integrations")!),
        .init(id: "freshdesk", title: "Freshdesk", vendorLabel: "Connect with Freshdesk", mark: "FD", tintHex: 0x4ECA7B, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developers.freshdesk.com/api/")!),
        .init(id: "notion", title: "Notion", vendorLabel: "Connect with Notion", mark: "N", tintHex: 0xF5F5F5, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://www.notion.so/my-integrations")!),
        .init(id: "clickup", title: "ClickUp", vendorLabel: "Connect with ClickUp", mark: "CU", tintHex: 0xAB9AFF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.clickup.com/login")!),
        .init(id: "asana", title: "Asana", vendorLabel: "Connect with Asana", mark: "A", tintHex: 0xF5A4B1, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.asana.com/0/developer-console")!),
        .init(id: "jira", title: "Jira", vendorLabel: "Connect with Atlassian", mark: "J", tintHex: 0x77A2FF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://id.atlassian.com/manage-profile/apps")!),
        .init(id: "confluence", title: "Confluence", vendorLabel: "Connect with Atlassian", mark: "C", tintHex: 0xB7C7FF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://id.atlassian.com/manage-profile/apps")!),
        .init(id: "monday", title: "Monday", vendorLabel: "Connect with Monday", mark: "M", tintHex: 0xFFB95E, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developer.monday.com/apps/docs/oauth")!),
        .init(id: "airtable", title: "Airtable", vendorLabel: "Connect with Airtable", mark: "AT", tintHex: 0xFFCF5A, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://airtable.com/create/tokens")!),
        .init(id: "todoist", title: "Todoist", vendorLabel: "Connect with Todoist", mark: "T", tintHex: 0xFF7D63, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developer.todoist.com/appconsole.html")!),
        .init(id: "calendly", title: "Calendly", vendorLabel: "Connect with Calendly", mark: "C", tintHex: 0x5C85FF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developer.calendly.com/")!),
        .init(id: "greenhouse", title: "Greenhouse", vendorLabel: "Connect with Greenhouse", mark: "G", tintHex: 0x66D1A4, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developers.greenhouse.io/")!),
        .init(id: "front", title: "Front", vendorLabel: "Connect with Front", mark: "F", tintHex: 0x4970FF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.frontapp.com/")!),
        .init(id: "intercom", title: "Intercom", vendorLabel: "Connect with Intercom", mark: "I", tintHex: 0x65A4FF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.intercom.com/")!),
        .init(id: "zendesk", title: "Zendesk", vendorLabel: "Connect with Zendesk", mark: "Z", tintHex: 0x2F6165, group: .productivity, description: nil, disclaimer: nil, requiredInput: .init(placeholder: "your-subdomain", suffix: ".zendesk.com"), externalURL: URL(string: "https://developer.zendesk.com/")!),
        .init(id: "bamboohr", title: "BambooHR", vendorLabel: "Connect with BambooHR", mark: "B", tintHex: 0x93C85C, group: .productivity, description: nil, disclaimer: nil, requiredInput: .init(placeholder: "your-company", suffix: ".bamboohr.com"), externalURL: URL(string: "https://documentation.bamboohr.com/")!),
        .init(id: "wrike", title: "Wrike", vendorLabel: "Connect with Wrike", mark: "W", tintHex: 0x5AB96A, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developers.wrike.com/")!),
        .init(id: "lever", title: "Lever", vendorLabel: "Connect with Lever", mark: "L", tintHex: 0xFFFFFF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://hire.lever.co/developer/documentation")!),
        .init(id: "trello", title: "Trello", vendorLabel: "Connect with Trello", mark: "T", tintHex: 0x6A92FF, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://developer.atlassian.com/cloud/trello/")!),
        .init(id: "coda", title: "Coda", vendorLabel: "Connect with Coda", mark: "C", tintHex: 0xF39B8C, group: .productivity, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://coda.io/developers/apis/v1")!),

        .init(id: "google-drive", title: "Google Drive", vendorLabel: "Connect with Google", mark: "G", tintHex: 0x66C17A, group: .fileStorage, description: nil, disclaimer: "Document access stays scoped to approved files and folders.", requiredInput: nil, externalURL: URL(string: "https://drive.google.com/")!),
        .init(id: "dropbox", title: "Dropbox", vendorLabel: "Connect with Dropbox", mark: "DB", tintHex: 0x7AA4FF, group: .fileStorage, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://www.dropbox.com/developers/apps")!),
        .init(id: "onedrive", title: "OneDrive", vendorLabel: "Connect with Outlook", mark: "OD", tintHex: 0x7AA4FF, group: .fileStorage, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://onedrive.live.com/")!),
        .init(id: "box", title: "Box", vendorLabel: "Connect with Box", mark: "B", tintHex: 0x4A7BFF, group: .fileStorage, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://account.box.com/login")!),

        .init(id: "google-analytics", title: "Google Analytics", vendorLabel: "Connect with Google", mark: "GA", tintHex: 0xF2C14E, group: .marketingAnalytics, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://analytics.google.com/")!),
        .init(id: "pipedrive", title: "Pipedrive", vendorLabel: "Connect with Pipedrive", mark: "P", tintHex: 0x58AD63, group: .marketingAnalytics, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.pipedrive.com/")!),
        .init(id: "klaviyo", title: "Klaviyo", vendorLabel: "Connect with Klaviyo", mark: "K", tintHex: 0xE4E4E4, group: .marketingAnalytics, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://www.klaviyo.com/login")!),
        .init(id: "hubspot", title: "HubSpot", vendorLabel: "Connect with HubSpot", mark: "HS", tintHex: 0xF8AE64, group: .marketingAnalytics, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.hubspot.com/")!),
        .init(id: "mailchimp", title: "Mailchimp", vendorLabel: "Connect with Mailchimp", mark: "MC", tintHex: 0xFFE06B, group: .marketingAnalytics, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://login.mailchimp.com/")!),
        .init(id: "sendgrid", title: "SendGrid", vendorLabel: "Connect with SendGrid", mark: "SG", tintHex: 0x6F9FFF, group: .marketingAnalytics, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.sendgrid.com/")!),
        .init(id: "shopify", title: "Shopify", vendorLabel: "Connect with Shopify", mark: "S", tintHex: 0xB6D468, group: .marketingAnalytics, description: nil, disclaimer: "Store access is best kept on a dedicated admin account.", requiredInput: nil, externalURL: URL(string: "https://admin.shopify.com/")!),
        .init(id: "posthog", title: "PostHog", vendorLabel: "Connect with PostHog", mark: "PH", tintHex: 0x8E6BFF, group: .marketingAnalytics, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.posthog.com/")!),

        .init(id: "github", title: "GitHub", vendorLabel: "Connect with GitHub", mark: "GH", tintHex: 0xF5F5F5, group: .development, description: nil, disclaimer: "Useful for repositories, issues, pull requests, and developer workflows.", requiredInput: nil, externalURL: URL(string: "https://github.com/settings/apps")!),
        .init(id: "gitlab", title: "GitLab", vendorLabel: "Connect with GitLab", mark: "GL", tintHex: 0xFF9A62, group: .development, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://gitlab.com/-/profile/applications")!),
        .init(id: "cloudflare", title: "Cloudflare", vendorLabel: "Connect with Cloudflare", mark: "CF", tintHex: 0xF2AE4A, group: .development, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://dash.cloudflare.com/profile/api-tokens")!),
        .init(id: "vercel", title: "Vercel", vendorLabel: "Connect with Vercel", mark: "V", tintHex: 0xFFFFFF, group: .development, description: nil, disclaimer: "Useful for deployment, environment, and hosted runtime workflows.", requiredInput: nil, externalURL: URL(string: "https://vercel.com/dashboard")!),
        .init(id: "supabase", title: "Supabase", vendorLabel: "Connect with Supabase", mark: "SB", tintHex: 0x66D1A4, group: .development, description: nil, disclaimer: nil, requiredInput: nil, externalURL: URL(string: "https://app.supabase.com/")!),
    ]
}
