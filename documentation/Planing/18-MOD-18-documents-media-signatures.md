# 18 - MOD-23: Documents, media, signatures and records management

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 2565-2668)

# 23. MOD-18 - Documents, media, signatures and records management

## 23.1 Purpose

Store and control SOPs, manuals, certificates, photos, videos, lab reports, permits, signed evidence and generated reports with version, ownership, retention and private access.

## 23.2 Primary users

All roles according to document scope; administrators, quality and records owners manage controlled content.

## 23.3 Capabilities

- Maintain document metadata, category, owner, applicability, confidentiality and retention class.
- Maintain version, approver, effective date, superseded status and next review.
- Link documents to organization, site, house, flock, asset, supplier, inventory lot, health case, shipment or task.
- Make approved SOPs and required manuals available offline to assigned users.
- Require read acknowledgement or training completion for selected documents.
- Support QR/deep-link access at houses/assets.
- Support photos, audio/video where approved, certificates, lab reports, invoices, manuals and generated exports.
- Capture electronic signatures with signer, purpose, timestamp, record hash/version and authentication context.
- Generate short-lived signed download URLs after authorization.
- Apply legal/incident/recall hold that prevents normal retention deletion.
- Record upload, view/download of sensitive documents, version changes and export.

## 23.4 Storage design

Recommended private buckets:

- `documents`
- `health-media`
- `maintenance-media`
- `biosecurity-media`
- `certificates`
- `reports-exports`
- `integration-files`

Public bucket use should be limited to intentionally public application assets.

Object path convention:

```text
{organization_id}/{site_id-or-global}/{entity_type}/{entity_id}/{file_id}.{extension}
```

A database `file_objects` row stores metadata, business ownership, checksum, content type, size, scan status, retention and storage path. Authorization must not rely only on an untrusted filename.

## 23.5 Upload and download flow

### Upload

1. Server validates user, target entity, file type/size and permission.
2. Browser receives a controlled upload path or signed upload method.
3. Browser uploads directly to private Storage.
4. Server/worker verifies object, checksum, malware scan where required and metadata.
5. File becomes available only after status `accepted`.

### Download

1. User requests file through Server Action/Route Handler.
2. Server rechecks RLS/permission and file status.
3. A short-lived signed URL is returned.
4. Sensitive download is audited.

## 23.6 Key entities

| Entity/table | Important fields |
|---|---|
| `documents` | Category, title, owner, confidentiality, applicability and status. |
| `document_versions` | Version, effective/review dates, approver, change summary and file object. |
| `file_objects` | Bucket/path, content type, size, checksum, scan status, retention and owner scope. |
| `entity_attachments` | Entity type/id, file object, purpose, caption and sequence. |
| `document_acknowledgements` | User, version, acknowledged time and device/session. |
| `electronic_signatures` | User, purpose, target record/version/hash, time and authentication context. |
| `retention_classes` | Duration, trigger, disposal method, review and legal-hold behavior. |
| `record_holds` | Scope, reason, authority, start/end and releaser. |

## 23.7 Business rules

- Private files never use permanent public URLs.
- Superseded document versions remain available for historical records but not as current work instructions.
- A signature attaches to an immutable record/version hash; changing the record invalidates the signature and requires a new approval.
- File extension, MIME type and content are validated; rejected/quarantined files are inaccessible.
- Retention jobs respect legal, incident, outbreak and recall holds.
- Camera/audio use requires explicit purpose, role access, retention and privacy approval.

## 23.8 UI and routes

- `/documents`
- `/documents/[documentId]`
- `/documents/review-due`
- `/records/holds`
- `/media`
- `/reports/exports`
- `/settings/retention`

## 23.9 Module acceptance gate

- Private files cannot be accessed across tenant/site scope or by guessing paths.
- Historical events show the exact document/SOP version used.
- Signed URLs expire and access is rechecked before issuance.
- Retention and legal-hold behavior are tested.

---


---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 2565-2668)*
