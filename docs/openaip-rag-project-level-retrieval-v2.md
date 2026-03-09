# OpenAIP RAG v2: Project-Level Retrieval

## 1) Architecture note
OpenAIP v2 moves QA retrieval from mixed category blocks to one-project-per-chunk records.  
This raises Context Precision because each retrieved item is narrowly scoped to one project row.  
It raises Faithfulness because generated answers can cite complete, coherent project evidence (amounts, dates, output, agency, and source page) instead of blending neighboring rows from grouped chunks.

## 2) Chunk schema / data structure
`public.aip_chunks` now supports typed retrieval chunks with filter-first metadata:

- `chunk_type public.aip_chunk_type` (`project | section_summary | category_summary | legacy_category_group`)
- `ingestion_version smallint`
- `document_type text`
- `publication_status text`
- `fiscal_year integer`
- `scope_type text`
- `scope_name text`
- `office_name text`
- `project_ref_code text`
- `source_page integer`
- `theme_tags text[]`
- `sector_tags text[]`
- existing `metadata jsonb` remains the forward-compatible canonical payload

Indexes:

- B-tree: `(chunk_type, publication_status, fiscal_year, scope_type, scope_name)`
- B-tree: `(document_type, office_name)`
- B-tree partial: `project_ref_code where not null`
- GIN: `theme_tags`
- GIN: `sector_tags`

## 3) Chunk templates
### Project-level chunk
```text
AIP Project
Document Type: {document_type}
Publication Status: {publication_status}
FY: {fiscal_year}
Scope Type: {scope_type}
Scope Name: {scope_name}
AIP ID: {aip_id}
AIP Ref Code: {aip_ref_code}
Title: {program_project_description}
Implementing Agency: {implementing_agency}
Office: {office_name}
Start Date: {start_date}
Completion Date: {completion_date}
Expected Output: {expected_output}
Source of Funds: {source_of_funds}
Personal Services: {personal_services}
MOOE: {maintenance_and_other_operating_expenses}
Capital Outlay: {capital_outlay}
Total: {total}
Sector Tags: {sector_tags_csv}
Theme Tags: {theme_tags_csv}
Source Page: {source_page}
Source Chunk ID: {record_key}
```

### Section/category summary chunk
```text
AIP Section Summary
Document Type: {document_type}
Publication Status: {publication_status}
FY: {fiscal_year}
Scope Type: {scope_type}
Scope Name: {scope_name}
Section Type: {office|service_category}
Section Name: {section_name}
Summary: {concise_summary}
Representative Project Refs: {aip_ref_codes_csv}
Top Themes: {theme_tags_csv}
Source Pages: {page_list}
Source Chunk ID: {record_key}
```

## 4) QA retrieval flow
1. Build retrieval filters from request + query hints (`publication_status`, FY, scope, optional doc type/office/tags).
2. Hard-filter in SQL RPC first.
3. Semantic search over `chunk_type='project'`.
4. Optional hybrid rerank (`semantic + lexical overlap + tag overlap`).
5. Return compact top-k (default 4; QA range 3-5).
6. Fallback order: include summaries if sparse, then temporary legacy dual-read.

## 5) Extraction + storage pipeline changes
- Edge indexer emits one `project` chunk per normalized project row.
- Secondary generators emit `section_summary` / `category_summary`.
- Deterministic thematic tags are generated and persisted in arrays + chunk text.
- Citation metadata is persisted per chunk (`aip_id`, `project_ref_code`, `source_page`, stable record key).
- Chunk writes now include explicit typed columns and `ingestion_version`.

## 6) Retrieval/RPC/search layer changes
- New RPC: `match_published_aip_project_chunks_v2(...)`.
- RPC applies hard metadata filters before vector ranking.
- QA mode excludes summary chunks by default.
- Retrieval service defaults to v2 project retrieval, with optional reranking and rollout dual-read fallback.
- API contracts now include:
  - `retrieval_mode: "qa" | "overview"` (default `qa`)
  - `retrieval_filters` object

## 7) Migration and cutover strategy
1. Deploy schema + RPC.
2. Backfill v2 columns and project/summary chunks from structured records.
3. Enable dual-read (v2 primary, legacy fallback when sparse).
4. Validate parity:
   - project chunk count ~= normalized project row count
   - citation spot checks map to specific project refs/pages
5. Cut over:
   - disable legacy fallback
   - stop generating `legacy_category_group`
   - optionally purge legacy rows after retention window

## 8) Practical impact on metrics
- Context Precision: fewer mixed/noisy chunks in top-k due project-level granularity + hard filters.
- Faithfulness: lower risk of cross-project blending; each citation points to a complete project record.
- Citation grounding: stronger per-source specificity (`project_ref_code`, `source_page`, typed chunk identity).
- Answer reliability: cleaner evidence set, narrower retrieval scope, and more predictable QA behavior.
