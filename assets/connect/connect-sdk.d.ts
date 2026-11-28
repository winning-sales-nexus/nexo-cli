export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
export interface HttpRequest {
    readonly method: HttpMethod;
    /**
     * Absolute URL. https on a host of the manifest's hosts; or http(s)://host:port on an API of the manifest's agents, which goes
     * down that agent's tunnel into the customer's network. The gateway refuses anything else.
     */
    readonly url: string;
    /**
     * x-nexo-agent-page (path=<array path>&offset=<n>&limit=<n>, limit up to 10000) works only on the initial load
     * (ctx.input.initialLoad) and only on an API of an agent: the agent calls once (up to 6 minutes and 120 MiB), keeps the answer and
     * returns 200 { itens, total, offset, proximo } per page, or 202 { carregando: true } while it loads (call again). After the
     * page whose proximo is null the agent deletes it.
     */
    readonly headers?: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
    /** A string goes as is; anything else is sent as JSON. */
    readonly body?: unknown;
}
export interface HttpResponse {
    /** True when a write did not reach the other system: a rehearsal, or a live write waiting for the first confirmation. */
    readonly planned: boolean;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    json(): unknown;
}
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface ConnectorState {
    /**
     * Kept between slices and between runs: a run starts from where the last one that ended well (succeeded or partial) left
     * it. Keep the cursor of the source here (the date of the last change read), and reset what only one run uses (a page).
     */
    get(key: string): JsonValue | undefined;
    set(key: string, value: JsonValue): void;
}
export interface ConnectorContext {
    readonly http: {
        /** Reads from the other system, whatever the method: a POST that only queries (Omie, SOAP) goes here. Real in rehearsals too. */
        request(request: HttpRequest): Promise<HttpResponse>;
        /**
         * Creates, changes or deletes something in the other system. A rehearsal records it without sending (planned: true). Live,
         * it needs externalWrites in the manifest, and the connector's first write waits for a person to confirm it: until then
         * it is held, the run's other writes are not sent, and each answers planned: true. Nothing sent here is undone.
         */
        write(request: HttpRequest): Promise<HttpResponse>;
    };
    /**
     * A SOAP service by its WSDL (fetched through the gateway, from a host of the manifest, with its imports). Each operation is a
     * function: client.read.<Operation>(args) when it only queries, client.write.<Operation>(args) when it creates or changes
     * something there, with the same rules as http.request and http.write. The WSDL is fetched once per slice.
     */
    soap(wsdlUrl: string, options?: SoapOptions): Promise<SoapClient>;
    /** XML as plain data, the way a SOAP answer comes: for a service that answers with XML inside a string. */
    xmlToJson(xml: string): JsonValue;
    /**
     * Files on an SFTP server of the manifest's sftp. The gateway connects (never the code), with the user and the secret the code
     * names, and hands back the listing or the spreadsheet already read: a CSV (any of ; , or tab) or an xlsx, by the file's extension.
     */
    readonly sftp: SftpFiles;
    /**
     * The spreadsheets that arrived by e-mail at the connector's own address (shown in Integrações), from a sender of the
     * manifest's email.senders. Only .csv, .tsv, .txt and .xlsx attachments within the size limit are kept, read the same way as
     * an SFTP file. Keep the id of the last file read in ctx.state and list after it, so each file is read once.
     */
    readonly email: EmailFiles;
    /**
     * Spreadsheets in a Google Drive folder of the manifest's drive.folders, read as the manifest's drive.account (a person of the
     * company, in its Google Workspace) through the Nexo's domain-wide delegation. The gateway calls Drive (never the code) and reads a
     * Google Sheets spreadsheet (exported as xlsx) or an uploaded .csv, .tsv, .txt or .xlsx the same way as an SFTP file. Keep the
     * modifiedAt of the newest file read in ctx.state and list after it, so each new file is read once.
     */
    readonly drive: DriveFiles;
    /**
     * Read-only queries on a database inside the customer's network (SQL Server, Oracle, Firebird), through the local agent the
     * manifest's agents names for it. The agent runs the query there with the read-only user of the manifest's secrets; only one
     * SELECT per call, and the agent's own list on that machine decides what it reaches.
     */
    readonly db: LocalDatabases;
    /** The Nexo: batch lookups and writes through the core, bound by the manifest's reads and writes. */
    readonly nexo: NexoApi;
    /** A reference to a secret of the manifest. The gateway swaps it for the value; the code never sees the value. */
    secret(name: string): string;
    readonly state: ConnectorState;
    log(message: string, data?: JsonValue): void;
    /** True once the slice is close to its end: save the cursor in state and return { done: false } to go on in the next slice. */
    shouldYield(): boolean;
    /** live applies writes; dry_run records them as planned. External reads are real in both. */
    readonly mode: RunMode;
    /**
     * What started the run: a NexoWebhookInput for a call to the connector's webhook, a NexoEventInput when a Nexo event of the manifest's
     * triggers started it, a NexoCallInput when a flow called it, a NexoOperationInput when someone asked for one of the
     * manifest's operations, a NexoInitialLoadInput on the initial load an admin started, or null for a scheduled or manual run.
     */
    readonly input: JsonValue | null;
}
/** A Nexo event that can start a run: a record created or changed, or a deal that went into a won stage. */
export type NexoEventName = 'company.created' | 'company.updated' | 'contact.created' | 'contact.updated' | 'deal.created' | 'deal.updated' | 'deal.won' | 'lead.created' | 'lead.updated' | 'ticket.created' | 'ticket.updated';
/**
 * The input of a run a call to the connector's webhook started. `body` is the JSON object, or the fields of a form-encoded body (a repeated field
 * becomes a list), or null for XML and plain text: then read `rawBody`. `authorization`, `cookie`, `proxy-authorization` and the header the
 * trigger's `auth` reads never reach `headers`. A rehearsal has no call: `ctx.input` is null, so treat null.
 */
export interface NexoWebhookInput {
    readonly body: JsonValue | null;
    readonly rawBody: string;
    readonly contentType: string | null;
    readonly headers: Readonly<Record<string, string>>;
    readonly query: Readonly<Record<string, string>>;
    /** When the Nexo accepted the call, as an ISO instant. */
    readonly receivedAt: string;
}
/** The input of the initial load: started once by an admin, never by the cron; read the whole source and leave the cursor for the cron. */
export interface NexoInitialLoadInput {
    readonly initialLoad: true;
}
/**
 * The input of a run a Nexo event started: ids only, never the record's data; read the record with ctx.nexo.get. The run starts once per eventId, however many
 * times the event arrives; deal.won has one eventId per deal, so a deal won again starts nothing. A write of this same
 * connector never starts it.
 */
export interface NexoEventInput {
    readonly event: NexoEventName;
    readonly eventId: string;
    readonly object: NexoObject;
    readonly recordId: string;
    /** ISO time of the change. */
    readonly occurredAt: string;
}
/**
 * The input of a run another module of the Nexo called (trigger "call"), contract 1: the object the caller built, with `contract` at its
 * top. The caller sizes it under the limit and never cuts it silently; the code never receives a secret in it.
 */
export interface NexoCallInput {
    readonly contract: 1;
    readonly [key: string]: JsonValue;
}
/** A profile the person holds: key is the default profile's key (admin, sales_lead, rep, read_only), or null for one the company made. */
export interface NexoOperationProfile {
    readonly id: string;
    readonly name: string;
    readonly key: string | null;
}
/** Who asked for the operation: the code may filter what it returns by this person (their own orders, their clients). */
export interface NexoOperationPerson {
    readonly userId: string;
    readonly name: string;
    readonly email: string;
    readonly profiles: readonly NexoOperationProfile[];
}
/**
 * The input of a run of one operation of the manifest, contract 2: which operation, its args (checked against the manifest before
 * the run: each of its type, the required ones present, nothing else) and who asked. A rehearsal of an action plans its writes,
 * as any rehearsal. The output is checked against the operation's own output.
 */
export interface NexoOperationInput {
    readonly contract: 2;
    readonly operation: string;
    readonly args: Readonly<Record<string, JsonValue>>;
    readonly person: NexoOperationPerson;
}
export type RunMode = 'live' | 'dry_run';
export type CallIntent = 'read' | 'write';
/** What the connector's default export returns. Nothing, or done: true, ends the run. */
export interface ConnectorResult {
    readonly done?: boolean;
    /**
     * What the run hands back to whoever called it (a flow step), on the run that ends: the fields of the manifest's output, each of
     * its type; a `list` field is an array of up to 50 objects with the item fields the manifest declares, and an `html` field is a string with the body of an e-mail (the Nexo cleans it when the run closes). Anything else, or a field of the wrong type, ends the run failed (invalid_output). Ignored by a run with no output
     * in its manifest, and in the slices that go on.
     */
    readonly output?: Readonly<Record<string, JsonValue>>;
}
export type ConnectorMain = (ctx: ConnectorContext) => Promise<ConnectorResult | undefined>;
export interface RunLimits {
    readonly timeoutMs: number;
    /** Before timeoutMs, from when shouldYield() answers true. */
    readonly yieldAfterMs: number;
    readonly memoryMb: number;
    readonly maxCalls: number;
    readonly maxResponseBytes: number;
    readonly maxLogBytes: number;
}
export interface GatewayAccess {
    readonly url: string;
    readonly token: string;
}
export interface LogEntry {
    readonly at: string;
    readonly message: string;
    readonly data?: JsonValue;
}
export interface SoapOptions {
    /** The address to call instead of the WSDL's soap:address: https, on a host of the manifest. */
    readonly endpoint?: string;
    /** The port of the WSDL, by name; by default the first SOAP 1.1 port. */
    readonly port?: string;
    /** HTTP headers of every call, the WSDL's fetch too (an Authorization with ctx.secret). */
    readonly headers?: Readonly<Record<string, string>>;
    /** XML that goes inside soap:Header of every call (WS-Security, a session token), with secrets as ctx.secret('NOME'). */
    readonly soapHeader?: string;
}
export interface SoapFault {
    readonly code: string;
    readonly message: string;
    readonly detail: JsonValue;
}
export interface SoapResponse {
    /** True when a write did not reach the other system (a rehearsal, or waiting for the first confirmation): data is null. */
    readonly planned: boolean;
    readonly status: number;
    /** The soap:Fault the service answered, or null. */
    readonly fault: SoapFault | null;
    /**
     * The content of the operation's output element as plain data, by element name, namespaces left out: every value is a string
     * (convert numbers and dates yourself), xsi:nil is null, and a field the WSDL says may repeat is always an array.
     */
    readonly data: JsonValue;
    /** The answer as it came, for what data leaves out (attributes). */
    readonly xml: string;
}
/** The arguments of an operation: its input fields by name, in any order (the client writes them in the WSDL's order). */
export interface SoapArguments {
    readonly [field: string]: JsonValue;
}
export type SoapOperation = (args?: SoapArguments) => Promise<SoapResponse>;
export interface SoapClient {
    readonly endpoint: string;
    /** The operations of the port, by name. */
    readonly operations: readonly string[];
    /** An operation that only queries: real in rehearsals too. */
    readonly read: {
        readonly [operation: string]: SoapOperation;
    };
    /** An operation that creates, changes or deletes something in the other system: an external write, planned in rehearsals. */
    readonly write: {
        readonly [operation: string]: SoapOperation;
    };
}
export interface SftpTarget {
    /** A host of the manifest's sftp, with the port written there. */
    readonly host: string;
    readonly port: number;
    readonly username: string;
    /** Only ctx.secret('NOME'): the gateway refuses a password written in the code. */
    readonly password?: string;
    /** A private key (OpenSSH or PEM), only as ctx.secret('NOME'). */
    readonly privateKey?: string;
}
export interface SftpPath extends SftpTarget {
    readonly path: string;
}
export interface SftpEntry {
    readonly name: string;
    readonly path: string;
    readonly type: 'file' | 'directory' | 'other';
    readonly size: number;
    /** ISO time of the last change: keep the newest one read in ctx.state to read only what is new. */
    readonly modifiedAt: string;
}
export interface SftpListing {
    readonly entries: readonly SftpEntry[];
    /** True when the folder has more entries than one listing brings. */
    readonly truncated: boolean;
}
export interface SheetCell {
    /** The text of the cell as the sheet shows it. */
    readonly text: string;
    /** The number of a number cell of an xlsx; null otherwise (a CSV is all text). */
    readonly number: number | null;
}
export interface FileSheet {
    readonly name: string | null;
    /** Lines in order, index 0 being line 1 (often the header); a line is its cells by column. */
    readonly rows: readonly (readonly SheetCell[])[];
    /** The last line with a value past the line limit, when the sheet was cut there; null when it came whole. */
    readonly cutAtLine: number | null;
}
export interface SpreadsheetFile {
    readonly path: string;
    readonly size: number;
    readonly modifiedAt: string;
    readonly sheets: readonly FileSheet[];
}
/** A spreadsheet that arrived at the connector's address: the attachment's name, its size and when the e-mail arrived. */
export interface EmailFile {
    readonly id: string;
    readonly name: string;
    readonly size: number;
    /** ISO time the e-mail arrived. */
    readonly receivedAt: string;
}
export interface EmailListing {
    /** Oldest first. */
    readonly files: readonly EmailFile[];
    /** True when more arrived than one listing brings: list again after the last id. */
    readonly truncated: boolean;
}
export interface EmailSpreadsheet extends EmailFile {
    readonly sheets: readonly FileSheet[];
}
export interface EmailListOptions {
    /** The id of the last file already read: only the ones that arrived after it come. */
    readonly after?: string;
}
export interface EmailFiles {
    /** The spreadsheets that arrived and are still kept (30 days), oldest first. */
    list(options?: EmailListOptions): Promise<EmailListing>;
    /** One of them read as sheets; its content never goes to the run's steps or logs. */
    readSpreadsheet(id: string): Promise<EmailSpreadsheet>;
}
/** A file in a Drive folder: its id, its name, what kind of file it is and when it last changed. */
export interface DriveFile {
    readonly id: string;
    readonly name: string;
    /** application/vnd.google-apps.spreadsheet for a Google Sheets spreadsheet; the uploaded file's type otherwise (text/csv...). */
    readonly mimeType: string;
    /** Bytes of an uploaded file; null for a Google Sheets spreadsheet, which has no size of its own. */
    readonly size: number | null;
    /** ISO time the file last changed. */
    readonly modifiedAt: string;
}
export interface DriveListing {
    /** Newest first; folders and trashed files never come. */
    readonly files: readonly DriveFile[];
    /** True when the folder has more files than one listing brings: list again after the oldest modifiedAt of this one. */
    readonly truncated: boolean;
}
export interface DriveSpreadsheet extends DriveFile {
    readonly sheets: readonly FileSheet[];
}
export interface DriveListOptions {
    /** A folder of the manifest's drive.folders: the id in the folder's link, after /folders/. */
    readonly folderId: string;
    /** An ISO time: only the files changed after it come. Keep the newest modifiedAt already read in ctx.state. */
    readonly modifiedAfter?: string;
}
export interface DriveFiles {
    /** The files of a folder, newest first. */
    list(options: DriveListOptions): Promise<DriveListing>;
    /** One file of a declared folder read as sheets; its content never goes to the run's steps or logs. */
    readSpreadsheet(fileId: string): Promise<DriveSpreadsheet>;
}
export interface SftpFiles {
    /** The entries of a folder, by name. */
    list(at: SftpPath): Promise<SftpListing>;
    /** A .csv, .tsv, .txt or .xlsx file read as sheets; its content never goes to the run's steps or logs. */
    readSpreadsheet(at: SftpPath): Promise<SpreadsheetFile>;
}
/**
 * A parameter of a query, in the position of its placeholder. A Date goes as a datetime; for an exact decimal, a date without time
 * or bytes, say the type: { type: 'decimal', value: '1234.50' }, { type: 'date', value: '2026-10-31' }, { type: 'binary', value: base64 }.
 */
export type SqlParam = string | number | boolean | null | Date | {
    readonly type: 'datetime' | 'date' | 'decimal' | 'binary';
    readonly value: string;
};
export interface SqlQuery {
    /** The name of a database of the manifest's agents (agents[].databases[].name). */
    readonly database: string;
    /**
     * One SELECT (or WITH ... SELECT), nothing that changes anything. Placeholders are the engine's own, by position:
     * SQL Server @p1, @p2...; Oracle :1, :2...; Firebird ?. Page in the query itself (ORDER BY a key and WHERE key > the last one
     * read, kept in ctx.state).
     */
    readonly sql: string;
    readonly params?: readonly SqlParam[];
    /** At most this many rows (the gateway caps it at 5000); more come with truncated: true. */
    readonly maxRows?: number;
}
/** How a column's values come: decimals and big integers as exact strings, dates and times as ISO strings, bytes as base64. */
export type SqlColumnType = 'text' | 'integer' | 'decimal' | 'float' | 'boolean' | 'date' | 'time' | 'datetime' | 'datetimeoffset' | 'binary' | 'other';
export interface SqlColumn {
    readonly name: string;
    readonly type: SqlColumnType;
}
/** A row by column name (give each column its own alias: a repeated name keeps the last one). */
export type SqlRow = {
    readonly [column: string]: JsonValue;
};
export interface SqlResult {
    readonly columns: readonly SqlColumn[];
    readonly rows: readonly SqlRow[];
    readonly rowCount: number;
    /** True when the query had more rows than maxRows (or than the size one answer brings): read the next page. */
    readonly truncated: boolean;
}
export interface LocalDatabases {
    /** Runs one read-only query on a database of the manifest's agents; real in rehearsals too, as every read. */
    query(query: SqlQuery): Promise<SqlResult>;
}


/**
 * Nexo objects a connector reads and writes; the manifest says which ones and which fields. `product` is the catalog of products
 * and services: its properties are the attributes the admin defined in the Nexo Admin, and a product never gets a twin (see `createMany`).
 */
export type NexoObject = 'company' | 'contact' | 'deal' | 'lead' | 'ticket' | 'product';
/** A record a lookup found. An archived one comes too: restore it in the update instead of creating a twin. */
export interface NexoMatch {
    readonly id: string;
    readonly archived: boolean;
}
/**
 * How to look records up, many values at once (up to 500): by a text field of the record (`cnpj` with or without its mask,
 * `email` in any case), by a custom property, or by the id the record has in another system (`ref`, set with `link`).
 */
export type NexoLookup = {
    readonly field: string;
} | {
    readonly property: string;
} | {
    readonly ref: string;
};
/** A boolean only where the field is one (`active` of a product). */
export type NexoFieldValue = string | number | boolean | null;
/**
 * A product's table of price tiers (`priceTiers` of the `product` object), in place of a single price. `mode` `flat` is a closed
 * price (the amount of the tier is the total) and `per_unit` a unit price (the amount is of each unit, times the quantity).
 * `measure` is what is counted ("fornecedores"), optional. From 1 to 200 tiers, `upTo` a positive integer rising from one tier to
 * the next, the last one alone with `upTo: null` (no ceiling); `amountInCents` an integer, 0 or more.
 */
export interface NexoPriceTiers {
    readonly mode: 'flat' | 'per_unit';
    readonly measure?: string | null;
    readonly tiers: readonly {
        readonly upTo: number | null;
        readonly amountInCents: number;
    }[];
}
/** The value of a field of a record: a scalar, or `priceTiers` of a product. */
export type NexoRecordValue = NexoFieldValue | NexoPriceTiers;
export type NexoPropertyValue = string | number | boolean | readonly string[] | null;
/**
 * Where a new lead came from, all optional: it is written as the lead's arrival (campaign, ad, form, UTM, landing page, consent),
 * so a rule can filter by it. The source stays `connect`; the connector (and its system) is recorded by the Nexo, never informed
 * here. Only on a lead that does not exist yet; a field outside this list refuses the record.
 */
export interface NexoLeadOrigin {
    readonly campaign?: string | null;
    readonly adId?: string | null;
    readonly formId?: string | null;
    readonly utm?: {
        readonly source?: string | null;
        readonly medium?: string | null;
        readonly campaign?: string | null;
        readonly term?: string | null;
        readonly content?: string | null;
    };
    readonly landingUrl?: string | null;
    readonly legalBasis?: string | null;
    readonly consentText?: string | null;
    /** When the person arrived, as an ISO instant; without it, the moment of the write. */
    readonly arrivedAt?: string;
}
/** The UTM of a planned origin: every key present, null when the connector did not tell it. */
interface NexoPlannedUtm {
    readonly source: string | null;
    readonly medium: string | null;
    readonly campaign: string | null;
    readonly term: string | null;
    readonly content: string | null;
}
/** The origin a rehearsal would write for a lead, with the source and the arrival moment filled. */
export interface NexoPlannedOrigin {
    readonly source: 'connect';
    readonly campaign: string | null;
    readonly adId: string | null;
    readonly formId: string | null;
    readonly utm: NexoPlannedUtm;
    readonly landingUrl: string | null;
    readonly legalBasis: string | null;
    readonly consentText: string | null;
    readonly arrivedAt: string;
}
export interface NexoRecordInput {
    /** Native fields, as the manifest names them. */
    readonly values?: Readonly<Record<string, NexoRecordValue>>;
    /** Custom properties by key; the manifest declares each as `property:<key>`. */
    readonly properties?: Readonly<Record<string, NexoPropertyValue>>;
    /**
     * The id this record has in the other system. The gateway links it when the record is written, as `link` would; a record the
     * core refuses keeps it in quarantine, so the reprocess that creates it links it too and the next run finds it by the ref.
     */
    readonly ref?: NexoRecordRef;
    /** Only on a new `lead`: where it came from (campaign, UTM...), written with its arrival. */
    readonly origin?: NexoLeadOrigin;
    /**
     * Only on a new `lead`, and not with `values.ownerId`: `"none"` opens it with no owner and outside the default routing. Without
     * `ownerId` and `routing`, the default routing picks the owner. `values.ownerId` (the id `users.findByEmail` returns) opens it with that owner.
     */
    readonly routing?: 'none';
}
export interface NexoRecordRef {
    readonly system: string;
    readonly externalId: string;
}
export interface NexoRecordUpdate extends NexoRecordInput {
    readonly id: string;
    /** Brings an archived record back in the same write. */
    readonly restore?: boolean;
}
/** The id a record has in another system, kept so the next run finds it with `find(object, { ref: system }, ids)`. */
export interface NexoRef {
    readonly id: string;
    readonly externalId: string;
}
/** An order, invoice or receivable of another system, on the timeline of the deal, company or contact it is linked to. */
export interface NexoTimelineEvent {
    readonly system: string;
    readonly externalId: string;
    readonly kind: 'order' | 'invoice' | 'receivable' | 'other';
    readonly title: string;
    readonly amountInCents?: number | null;
    /** The day, as YYYY-MM-DD. */
    readonly occurredOn?: string | null;
    readonly status?: string | null;
    /** Only http or https. */
    readonly url?: string | null;
    readonly links?: readonly {
        readonly objectType: 'deal' | 'company' | 'contact';
        readonly id: string;
    }[];
}
/** A record of a write the core refused: it went to the run's quarantine, the others of the call were written. */
export interface NexoRefusal {
    /** Its position in the records of the call. */
    readonly index: number;
    readonly code: string;
    readonly reason: string;
}
/**
 * A record as the connector reads it: its native fields by their manifest names and its custom properties by key. A script a rule
 * called reads only the records the rule's person reaches; one a trigger of its own started reads the company. An archived record
 * comes too, marked.
 */
export interface NexoRecordRead {
    readonly id: string;
    readonly archived: boolean;
    readonly values: Readonly<Record<string, NexoRecordValue>>;
    readonly properties: Readonly<Record<string, NexoPropertyValue>>;
}
/** How a filter of `query` compares; the same operators as the condition of an automation. */
export type NexoOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in' | 'not_in' | 'contains' | 'is_empty' | 'is_not_empty' | 'older_than' | 'within_last';
/**
 * What a filter compares to: one value (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`), a list of up to 50 (`in`, `not_in`), the
 * smaller and the larger (`between`), or a number of days (`older_than`, `within_last`). `is_empty` and `is_not_empty` take none.
 * Dates are YYYY-MM-DD (or an ISO instant) and money is in cents.
 */
export type NexoFilterValue = string | number | boolean | readonly (string | number | boolean)[];
/**
 * One condition of a query, on a native field (`{ field: 'amountInCents', op: 'gt', value: 1000000 }`) or on a custom property
 * (`{ property: 'segment', op: 'eq', value: 'varejo' }`). A comparison holds only for a filled value: a record with no value never
 * matches `neq` or `not_in`, and only `is_empty` asks for the empty. Text ignores case and edges. A `contains` or a range (`gt`,
 * `gte`, `lt`, `lte`, `between`, `older_than`, `within_last`) on a property comes only together with an `eq` or `in` on another
 * property, or on an indexed field (`email` of a contact, `cnpj` of a company, `ownerId`, `pipelineId`, `stageId`, `personId` of a
 * lead or ticket).
 */
export type NexoFilter = {
    readonly field: string;
    readonly op: NexoOperator;
    readonly value?: NexoFilterValue;
} | {
    readonly property: string;
    readonly op: NexoOperator;
    readonly value?: NexoFilterValue;
};
/** What `query` takes besides the entity. All the filters must hold (and). */
export interface NexoQueryInput {
    readonly where?: readonly NexoFilter[];
    /** `id` (the default) or `createdAt`, the second only for `deal`. */
    readonly orderBy?: 'id' | 'createdAt';
    /** `asc` is the default. */
    readonly direction?: 'asc' | 'desc';
    /** Records per page, from 1 to 500; 100 when absent. */
    readonly limit?: number;
    /** The `next` of the page before; absent for the first page. */
    readonly cursor?: string;
    /** Archived records stay out unless true. */
    readonly includeArchived?: boolean;
}
/**
 * A page of a query. `next` is the cursor of the page after, or null at the end. The cursor is opaque and is not a snapshot of
 * the moment: it continues after the last record of this page, so a record created or changed while the pages are read can come
 * in a later page, or not come.
 */
export interface NexoPage {
    readonly records: NexoRecordRead[];
    readonly next: string | null;
}
export interface NexoUser {
    readonly id: string;
    readonly name: string;
    /** The person's owner in the Nexo CRM, the id `ownerId` takes; null when the person is not an active owner there. */
    readonly ownerId: string | null;
}
/** A record of the person the lookup found: its id and its owner in the Nexo CRM (null when it has none). */
export interface NexoPersonRecord {
    readonly id: string;
    readonly ownerId: string | null;
}
/** What the lead entry sees for a phone and an e-mail: the open lead and the contact, and how many deals the contact has in progress and won. */
export interface NexoPersonLookup {
    readonly found: boolean;
    readonly lead: NexoPersonRecord | null;
    readonly contact: NexoPersonRecord | null;
    readonly deals: {
        readonly open: number;
        readonly won: number;
    };
}
/** The keys of a person lookup: at least one of the two, as the lead entry reads them. */
export interface NexoPersonKeys {
    readonly phone?: string;
    readonly email?: string;
}
/** A person of the other system (a rep of the ERP) to find in the company by e-mail, or to add to its list. */
export interface NexoPersonInput {
    readonly email: string;
    /** The name the person gets when added; the start of the e-mail when it is shorter than two letters. */
    readonly name: string;
}
/**
 * The Nexo, through the core write: every write of a run is one change, undone at once. It never deletes. A rehearsal finds
 * for real and plans the writes without applying them, answering ids that exist only in the rehearsal. An empty list (no
 * values to find, no records, no refs) is answered without a call.
 */
export interface NexoApi {
    /** One record by its id, for an object of the manifest's reads; null when it does not exist. The run of a Nexo event reads its record here. */
    get(object: NexoObject, id: string): Promise<NexoRecordRead | null>;
    find(object: NexoObject, by: NexoLookup, values: readonly string[]): Promise<Record<string, NexoMatch[]>>;
    /**
     * Lists the records of an entity by filter, in pages of up to 500: `deal`, `lead`, `contact`, `company` and `ticket`, with their
     * custom properties (a `product`, with its attributes, is read with `get` and `find`), `meeting`, `task`, `document`, `negotiation` and `temperature` (native fields only), `lead_arrival` (the arrivals of a lead: `leadId`, `contactId`, `system`, `source`, `campaign` and the UTM fields filter them; most recent first by `arrivedAt` with `direction: 'desc'`), and `whatsapp_chat`, the WhatsApp chats whose client waits for an answer. The entity must be in the manifest's reads and have a read door:
     * one without it is refused, never read as the company. The records are the native ones, as `get` brings them, and a script a
     * rule called gets only the ones the rule's person reaches. Pages by `id` come in the order of the id, and by `createdAt` where
     * the entity has an index for it. The step keeps the entity, the filtered fields and the count, never the values.
     * To list everything, ask page after page until `next` is null:
     * `let cursor; do { const page = await ctx.nexo.query('deal', { where, cursor }); ...; cursor = page.next ?? undefined; } while (cursor)`.
     */
    query(entity: string, query?: NexoQueryInput): Promise<NexoPage>;
    /** The id, or null when the core refused the record: it is in the run's quarantine and the run ends partial. */
    create(object: NexoObject, record: NexoRecordInput): Promise<string | null>;
    /**
     * Up to 100 records in one call, created in order; the ids come back in the same order. A record the core refuses (an
     * invalid CNPJ, an option that does not exist) gets null and goes to the run's quarantine; the others are written. A
     * `product` needs its `ref`, and lands on the product its ref already points at, or the one with its `code` (whatever made
     * it), before a new one is born: the id that comes back may be of a product that already existed.
     */
    createMany(object: NexoObject, records: readonly NexoRecordInput[]): Promise<(string | null)[]>;
    /** False when the core refused the record and set it aside in quarantine. */
    update(object: NexoObject, record: NexoRecordUpdate): Promise<boolean>;
    /** The refused ones of the call, by position; the others were written. */
    updateMany(object: NexoObject, records: readonly NexoRecordUpdate[]): Promise<NexoRefusal[]>;
    link(object: NexoObject, system: string, refs: readonly NexoRef[]): Promise<void>;
    readonly timeline: {
        /** The same (system, externalId) again updates the event instead of duplicating it. */
        upsert(event: NexoTimelineEvent): Promise<{
            id: string;
            created: boolean;
        }>;
        upsertMany(events: readonly NexoTimelineEvent[]): Promise<{
            id: string;
            created: boolean;
        }[]>;
    };
    readonly users: {
        /** People of the company by e-mail, to pick an owner; an unknown e-mail maps to null. */
        findByEmail(emails: readonly string[]): Promise<Record<string, NexoUser | null>>;
        /**
         * The same answer as `findByEmail`, adding the ones the company does not have yet: a new e-mail becomes a person only on the
         * list (viewer seat, Somente leitura profile, no login, no e-mail sent) with an owner id the same run can write. A person of
         * the company, active or not, comes back as is, nothing changed. An invalid e-mail, or one of another company, maps to null.
         * Up to 500 per call, a repeated e-mail counting once; the keys are the e-mails as sent. Needs `"users": ["ensure"]` in the
         * manifest. A rehearsal adds nobody and answers ids that exist only in the rehearsal. Undoing the run removes nobody.
         */
        ensure(people: readonly NexoPersonInput[]): Promise<Record<string, NexoUser | null>>;
    };
    readonly people: {
        /**
         * What the Nexo knows of a person by phone and e-mail, the keys normalized as the lead entry does (the phone with or without the
         * ninth digit is the same person). Writes nothing, and runs for real in a rehearsal. Needs `person` in the manifest's reads; a run a
         * rule called sees only what that rule's person reaches. `found` is false for a person nobody holds.
         * To skip who already has a deal in progress: `const known = await ctx.nexo.people.lookup({ phone }); if (known.deals.open > 0) return;`.
         */
        lookup(keys: NexoPersonKeys): Promise<NexoPersonLookup>;
    };
}
/** The call as the gateway takes it. */
export type NexoCall = {
    readonly op: 'find';
    readonly object: NexoObject;
    readonly by: NexoLookupCall;
    readonly values: readonly string[];
} | {
    readonly op: 'get';
    readonly object: NexoObject;
    readonly id: string;
} | ({
    readonly op: 'query';
    readonly entity: string;
} & NexoQueryInput) | {
    readonly op: 'write';
    readonly object: NexoObject;
    readonly records: readonly NexoRecordCall[];
} | {
    readonly op: 'link';
    readonly object: NexoObject;
    readonly system: string;
    readonly refs: readonly NexoRef[];
} | {
    readonly op: 'timeline';
    readonly events: readonly NexoTimelineEvent[];
} | {
    readonly op: 'users';
    readonly emails: readonly string[];
} | ({
    readonly op: 'person';
} & NexoPersonKeys) | {
    readonly op: 'ensureUsers';
    readonly people: readonly NexoPersonInput[];
};
export type NexoLookupCall = {
    readonly kind: 'field';
    readonly field: string;
} | {
    readonly kind: 'property';
    readonly property: string;
} | {
    readonly kind: 'ref';
    readonly system: string;
};
export interface NexoRecordCall extends NexoRecordInput {
    readonly id?: string;
    readonly restore?: boolean;
}
/** The gateway's answer to a Nexo call. */
export type NexoReply = {
    readonly op: 'find';
    readonly matches: Record<string, NexoMatch[]>;
} | {
    readonly op: 'get';
    readonly record: NexoRecordRead | null;
} | {
    readonly op: 'query';
    readonly records: NexoRecordRead[];
    readonly next: string | null;
} | {
    readonly op: 'write';
    readonly planned: boolean;
    readonly ids: (string | null)[];
    readonly refused: NexoRefusal[];
    /** A rehearsal of new leads: the origin each would be written with (null for a refused one), in the order of the records. */
    readonly origins?: (NexoPlannedOrigin | null)[];
} | {
    readonly op: 'link';
    readonly planned: boolean;
    readonly linked: number;
} | {
    readonly op: 'timeline';
    readonly planned: boolean;
    readonly events: {
        id: string;
        created: boolean;
    }[];
} | {
    readonly op: 'users';
    readonly users: Record<string, NexoUser | null>;
} | {
    readonly op: 'person';
    readonly person: NexoPersonLookup;
} | {
    readonly op: 'ensureUsers';
    readonly planned: boolean;
    /** How many people the call added to the list, or would add in a rehearsal. */
    readonly created: number;
    readonly users: Record<string, NexoUser | null>;
};
export {};


/** One operation of the manifest, as the code implements it: ctx as always, and the input with the args and the person. */
export type OperationHandler = (ctx: ConnectorContext, input: NexoOperationInput) => Promise<ConnectorResult | undefined>;
/** The name the run records for an operation that refused the call by the connector's own rule. */
export declare const OPERATION_REFUSED: string;
/**
 * Thrown by an operation that refuses the call by the connector's own rule, before any call to the other system: an operation
 * outside the allowed list, a DELETE, a payroll or ledger operation. The Nexo answers that the connector does not allow it, and
 * not that the other system failed, so the assistant knows that calling again changes nothing:
 * `throw new OperationRefused('ExcluirPedido fica sempre fora da ponte')`. A failure of the other system stays a plain Error.
 */
export declare class OperationRefused extends Error {
    constructor(message: string);
}
/**
 * The default export of a connector made of operations, from one function per operation key:
 * `export default operations({ titulos_vencidos: async (ctx, { args, person }) => ({ output: { ... } }) })`.
 * An operation the manifest declares and the code does not implement fails the run with its name.
 */
export declare function operations(handlers: Readonly<Record<string, OperationHandler>>): ConnectorMain;
