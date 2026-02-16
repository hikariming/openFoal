const enUS = {
  app: {
    brand: "OpenFoal Enterprise Console",
    subtitle: "Governance and Runtime Control"
  },
  nav: {
    chat: "Chat",
    dashboard: "Dashboard",
    sessions: "Sessions",
    users: "Users",
    policies: "Policies",
    secrets: "Model Secrets",
    audit: "Audit",
    agents: "Agents",
    targets: "Targets",
    budget: "Budget",
    context: "Context",
    infra: "Infrastructure"
  },
  common: {
    loading: "Loading...",
    refresh: "Refresh",
    save: "Save",
    create: "Create",
    createNew: "Create New",
    update: "Update",
    edit: "Edit",
    actions: "Actions",
    search: "Search",
    filter: "Filter",
    clear: "Clear",
    apply: "Apply",
    cancel: "Cancel",
    confirm: "Confirm",
    reset: "Reset",
    loadMore: "Load More",
    login: "Login",
    logout: "Logout",
    language: "Language",
    pageSize: "Page Size",
    total: "Total",
    previous: "Previous",
    next: "Next",
    tenantId: "Tenant",
    workspaceId: "Workspace",
    userId: "User",
    scopeKey: "Scope",
    runtimeMode: "Runtime",
    enabled: "Enabled",
    disabled: "Disabled",
    noData: "No data",
    forbidden: "You are not allowed to access this page or action."
  },
  auth: {
    title: "Enterprise Login",
    tenant: "Tenant Code",
    username: "Username",
    password: "Password"
  },
  chat: {
    brand: "OpenFoal Enterprise Chat",
    newSession: "+ New Session",
    emptySessionPreview: "empty",
    noSessionTitle: "No Session",
    noActiveSession: "No active session",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    noMessages: "No messages yet.",
    composerPlaceholder: "Type a message...",
    send: "Send",
    running: "Running...",
    roleUser: "User",
    roleAssistant: "Assistant",
    roleSystem: "System",
    backToAdmin: "Back to Admin"
  },
  dashboard: {
    title: "Runtime Overview",
    metrics: "Metrics",
    recentSessions: "Recent Sessions",
    recentAudit: "Recent Audit",
    runsTotal: "Runs Total",
    runsFailed: "Runs Failed",
    toolCalls: "Tool Calls",
    p95: "P95 Latency"
  },
  sessions: {
    title: "Session Management",
    createTitle: "Create Session",
    sessionTitle: "Session Title",
    history: "Session History",
    view: "View",
    local: "Local",
    cloud: "Cloud"
  },
  users: {
    title: "User Management",
    createUser: "Create User",
    status: "Status",
    resetPassword: "Reset Password",
    memberships: "Memberships",
    role: "Role",
    username: "Username",
    password: "Password",
    displayName: "Display Name",
    email: "Email",
    newPassword: "New Password"
  },
  policies: {
    title: "Policy Management",
    toolDefault: "Tool Default",
    highRisk: "High Risk",
    bashMode: "Bash Mode",
    toolsOverride: "Tools Override (JSON)"
  },
  secrets: {
    title: "Model Secrets",
    formTitle: "Create or Update Model Secret",
    formHint: "Use provider presets first, then adjust model and key fields.",
    provider: "Provider",
    modelId: "Model ID",
    baseUrl: "Base URL",
    apiKey: "API Key",
    masked: "Saved Secrets",
    modelQuickPick: "Quick Model Picks",
    baseUrlQuickPick: "Quick Endpoint Picks",
    clearForm: "Reset Form",
    searchPlaceholder: "Search provider / model / workspace / baseUrl",
    total: "Total",
    loadToForm: "Load for Edit",
    providerApiKeyRequired: "Provider and API key are required."
  },
  audit: {
    title: "Audit Logs",
    action: "Action",
    from: "From",
    to: "To"
  },
  agents: {
    title: "Agent Management",
    agentId: "Agent ID",
    name: "Name",
    executionTargetId: "Execution Target",
    policyScopeKey: "Policy Scope Key"
  },
  targets: {
    title: "Execution Targets",
    targetId: "Target ID",
    kind: "Kind",
    endpoint: "Endpoint",
    authToken: "Auth Token",
    isDefault: "Default"
  },
  budget: {
    title: "Budget Management",
    tokenDailyLimit: "Daily Token Limit",
    costMonthlyUsdLimit: "Monthly Cost Limit (USD)",
    hardLimit: "Hard Limit",
    usage: "Usage"
  },
  context: {
    title: "Context Management",
    layer: "Layer",
    file: "File",
    content: "Content",
    load: "Load",
    tenant: "Tenant Layer",
    workspace: "Workspace Layer",
    user: "User Layer"
  },
  infra: {
    title: "Infrastructure",
    health: "Health",
    reconcile: "Storage Reconcile"
  }
};

export default enUS;
