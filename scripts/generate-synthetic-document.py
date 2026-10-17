"""Project-created deterministic file lifecycle fixture, never legal evidence."""
from pathlib import Path
import hashlib
import json
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pypdf import PdfReader

root = Path(__file__).resolve().parent.parent
folder = root / 'demo-assets' / 'c02'
folder.mkdir(parents=True, exist_ok=True)
target = folder / 'xland-demo-file-lifecycle.pdf'
c = canvas.Canvas(str(target), pagesize=(595, 842), invariant=1)
c.setTitle('XLAND DEMO ONLY - synthetic file lifecycle fixture')
c.setAuthor('XLand project procedural generator')
c.setFillColor(HexColor('#183C34'))
c.rect(0, 630, 595, 212, fill=1, stroke=0)
c.setFillColor(HexColor('#FFFFFF'))
c.setFont('Helvetica-Bold', 30)
c.drawString(48, 768, 'XLAND DEMO ONLY')
c.setFont('Helvetica', 16)
c.drawString(48, 730, 'Synthetic file lifecycle fixture')
c.setFillColor(HexColor('#183C34'))
c.setFont('Helvetica-Bold', 19)
c.drawString(48, 574, 'NOT A LAND RECORD OR LEGAL EVIDENCE')
c.setFont('Helvetica', 12)
lines = [
    'This file is created by the XLand project for integration tests.',
    'It contains no customer documents, signatures, seals or parcel details.',
    'It does not certify ownership, planning, valuation or legal verification.',
    '',
    'Test scope: MIME and bytes, owner access, grant and expiry,',
    'download, open, retry and file cleanup.',
    '',
    'Approval: Agent A decision A-13, client date 2026-10-17.',
    'Rights: project-created text and vector layout; no external assets.',
    'Font: standard PDF Helvetica, no external font binary embedded.',
    '',
    'Private storage and HTTPS signing are separate configuration inputs.',
    'A local PDF render does not prove L02 provider or authorization flow.',
    'Legal signed URL lifetime must not exceed 300 seconds.',
]
for index, line in enumerate(lines):
    c.drawString(48, 532 - index * 24, line)
c.setFont('Helvetica-Bold', 12)
c.drawString(48, 76, 'DEMO / NOT VERIFIED / NO REAL LAND EVIDENCE')
c.setFont('Helvetica', 10)
c.drawRightString(547, 44, 'XLand Phase 2 file fixture - 1 / 1')
c.showPage()
c.save()
data = target.read_bytes()
reader = PdfReader(target)
assert data.startswith(b'%PDF-') and len(reader.pages) == 1
assert 'NOT A LAND RECORD OR LEGAL EVIDENCE' in reader.pages[0].extract_text()
manifest = {
    'source': 'XLand project procedural text/vector generator',
    'approval': 'A-13 synthetic DEMO source only, 2026-10-17',
    'rights': 'Created for XLand integration; no customer/third-party documents',
    'attribution': 'XLand project; standard PDF Helvetica, no font binary embedded',
    'legalEvidence': False, 'legalVerified': False,
    'file': target.name, 'mimeType': 'application/pdf', 'sizeBytes': len(data),
    'sha256': hashlib.sha256(data).hexdigest(),
    'generator': 'scripts/generate-synthetic-document.py',
    'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'privateStorageConfigured': False, 'httpsSignerConfigured': False,
    'signedUrlMaxSeconds': 300,
}
(folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
print(json.dumps({'syntheticPdfCreated': True, 'mimeType': 'application/pdf', 'sizeBytes': len(data), 'sha256': manifest['sha256'], 'legalVerified': False}))
