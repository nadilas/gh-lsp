// ─── LSP Position & Range ─────────────────────────────────────────────────────

/** LSP Position (0-indexed line and character) */
export interface LspPosition {
  line: number;
  character: number;
}

/** LSP Range (start and end positions) */
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** LSP Location (URI + range, used in definition responses) */
export interface LspLocation {
  uri: string;
  range: LspRange;
}

// ─── LSP Content Types ────────────────────────────────────────────────────────

export type MarkupKind = 'plaintext' | 'markdown';

export interface MarkupContent {
  kind: MarkupKind;
  value: string;
}

// ─── LSP Result Types ─────────────────────────────────────────────────────────

export interface LspHover {
  contents: MarkupContent;
  range?: LspRange;
}

export interface LspParameterInformation {
  label: string | [number, number];
  documentation?: MarkupContent | string;
}

export interface LspSignatureInformation {
  label: string;
  documentation?: MarkupContent | string;
  parameters?: LspParameterInformation[];
}

export interface LspSignatureHelp {
  signatures: LspSignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

// ─── LSP Capabilities ────────────────────────────────────────────────────────

export interface LspServerCapabilities {
  hoverProvider: boolean;
  definitionProvider: boolean;
  signatureHelpProvider?: boolean;
}

export interface LspClientCapabilities {
  textDocument: {
    hover: { contentFormat: MarkupKind[] };
    definition: Record<string, never>;
    signatureHelp?: Record<string, never>;
  };
}

// ─── LSP Lifecycle ────────────────────────────────────────────────────────────

export interface LspInitializeParams {
  rootUri: string | null;
  capabilities: LspClientCapabilities;
}

export interface LspInitializeResult {
  capabilities: LspServerCapabilities;
}

export interface LspTextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface LspDidOpenTextDocumentParams {
  textDocument: LspTextDocumentItem;
}

export interface LspTextDocumentPositionParams {
  textDocument: { uri: string };
  position: LspPosition;
}

// ─── JSON-RPC 2.0 ────────────────────────────────────────────────────────────

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: T;
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result: T;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse;

export const LspErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
  RequestCancelled: -32800,
  ContentModified: -32801,
} as const;

export type LspErrorCode = (typeof LspErrorCode)[keyof typeof LspErrorCode];

// ─── Supported Languages ──────────────────────────────────────────────────────

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'go'
  | 'rust'
  | 'python'
  | 'elixir';

export type FileExtensionMap = Record<string, SupportedLanguage>;

// ─── Repository & File Context ────────────────────────────────────────────────

export interface RepoContext {
  owner: string;
  repo: string;
  ref: string;
  filePath: string;
  language: string;
}

export type DiffSide = 'base' | 'head';

export interface DiffFileContext extends RepoContext {
  side: DiffSide;
}

export type GitHubViewType = 'blob' | 'pull-request-files' | 'compare';

export interface GitHubPageState {
  viewType: GitHubViewType;
  isActive: boolean;
  files: RepoContext[];
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export type ExtensionErrorCode =
  | 'unsupported_language'
  | 'lsp_server_error'
  | 'lsp_timeout'
  | 'fetch_error'
  | 'fetch_not_found'
  | 'fetch_unauthorized'
  | 'rate_limited'
  | 'parse_error'
  | 'worker_crash'
  | 'worker_limit_reached';

export interface ExtensionError {
  code: ExtensionErrorCode;
  message: string;
  language?: string;
  retryAfter?: number;
}

// ─── Worker Status ────────────────────────────────────────────────────────────

export type WorkerStatus =
  | 'idle'
  | 'loading'
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'shutting_down'
  | 'error'
  | 'terminated';

// ─── Extension Messages (Content Script <-> Background) ───────────────────────

export type MessageType =
  | 'lsp/hover'
  | 'lsp/definition'
  | 'lsp/signatureHelp'
  | 'lsp/cancel'
  | 'lsp/response'
  | 'lsp/error'
  | 'settings/changed'
  | 'rateLimit/warning'
  | 'worker/status'
  | 'extension/toggle'
  | 'page/navigated';

// --- Requests (Content Script -> Background) ---

export interface LspHoverRequest {
  type: 'lsp/hover';
  requestId: string;
  owner: string;
  repo: string;
  ref: string;
  filePath: string;
  position: LspPosition;
}

export interface LspDefinitionRequest {
  type: 'lsp/definition';
  requestId: string;
  owner: string;
  repo: string;
  ref: string;
  filePath: string;
  position: LspPosition;
}

export interface LspSignatureHelpRequest {
  type: 'lsp/signatureHelp';
  requestId: string;
  owner: string;
  repo: string;
  ref: string;
  filePath: string;
  position: LspPosition;
}

export interface LspCancelRequest {
  type: 'lsp/cancel';
  requestId: string;
}

// --- Responses (Background -> Content Script) ---

export interface LspHoverResponse {
  type: 'lsp/response';
  requestId: string;
  kind: 'hover';
  result: LspHover | null;
}

export interface LspDefinitionResponse {
  type: 'lsp/response';
  requestId: string;
  kind: 'definition';
  result: LspLocation[];
}

export interface LspSignatureHelpResponse {
  type: 'lsp/response';
  requestId: string;
  kind: 'signatureHelp';
  result: LspSignatureHelp | null;
}

export interface LspErrorResponse {
  type: 'lsp/error';
  requestId: string;
  error: ExtensionError;
}

// --- Notifications (Background -> Content Script) ---

export interface RateLimitWarningMessage {
  type: 'rateLimit/warning';
  resetAt: number;
}

export interface WorkerStatusMessage {
  type: 'worker/status';
  language: SupportedLanguage;
  status: WorkerStatus;
}

export interface SettingsChangedMessage {
  type: 'settings/changed';
  changes: Partial<ExtensionSettings>;
}

export interface ExtensionToggleMessage {
  type: 'extension/toggle';
  enabled: boolean;
}

export interface PageNavigatedMessage {
  type: 'page/navigated';
  newContext: RepoContext | null;
}

/** Discriminated union of all messages sent via chrome.runtime messaging */
export type ExtensionMessage =
  | LspHoverRequest
  | LspDefinitionRequest
  | LspSignatureHelpRequest
  | LspCancelRequest
  | LspHoverResponse
  | LspDefinitionResponse
  | LspSignatureHelpResponse
  | LspErrorResponse
  | RateLimitWarningMessage
  | WorkerStatusMessage
  | SettingsChangedMessage
  | ExtensionToggleMessage
  | PageNavigatedMessage;

// ─── Worker Messages (Background <-> Web Worker) ──────────────────────────────

export type WorkerMessageType =
  | 'jsonrpc'
  | 'gh-lsp/requestFile'
  | 'worker/ready'
  | 'worker/error';

export interface WorkerMessage {
  type: WorkerMessageType;
  payload: unknown;
}

// ─── Extension Settings ───────────────────────────────────────────────────────

export type DisplayMode = 'popover' | 'sidebar';

export type SidebarPosition = 'right' | 'left' | 'top' | 'bottom';

export type ThemeMode = 'auto' | 'light' | 'dark';

export interface ExtensionSettings {
  displayMode: DisplayMode;
  sidebarPosition: SidebarPosition;
  hoverDebounceMs: number;
  enabledLanguages: SupportedLanguage[];
  cacheTimeoutMinutes: number;
  workerIdleTimeoutMinutes: number;
  maxConcurrentWorkers: number;
  theme: ThemeMode;
  showLoadingIndicator: boolean;
  keyboardShortcutToggle: string;
  keyboardShortcutSidebar: string;
  keyboardShortcutPinPopover: string;
  enabled: boolean;
  sidebarSize: number;
}

/** PAT stored separately in chrome.storage.local for security */
export interface SecureSettings {
  githubPat: string;
}

// ─── UI State ─────────────────────────────────────────────────────────────────

export type PopoverState = 'hidden' | 'loading' | 'visible' | 'pinned' | 'error';

export type SidebarState = 'hidden' | 'collapsed' | 'expanded';

export interface PopoverPosition {
  top: number;
  left: number;
  placement: 'above' | 'below';
}

export interface HoverDisplayData {
  signature: string;
  language: SupportedLanguage;
  documentation?: string;
  parameters?: ParameterDisplayData[];
  definitionLocation?: LspLocation;
  declarationSource?: string;
}

export interface ParameterDisplayData {
  name: string;
  type: string;
  defaultValue?: string;
  documentation?: string;
}

export type DetectedTheme = 'light' | 'dark';

// ─── Popup State ──────────────────────────────────────────────────────────────

export interface PopupStatus {
  extensionEnabled: boolean;
  isOnSupportedPage: boolean;
  detectedLanguage: SupportedLanguage | null;
  workerStatus: WorkerStatus | null;
  displayMode: DisplayMode;
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

export interface GitHubContentsResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  encoding: 'base64' | 'none';
  content: string;
  download_url: string | null;
}

export interface GitHubRateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number;
  used: number;
}

export interface GitHubApiError {
  message: string;
  documentation_url?: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  key: string;
  value: T;
  cachedAt: number;
  ttlMs: number;
}
