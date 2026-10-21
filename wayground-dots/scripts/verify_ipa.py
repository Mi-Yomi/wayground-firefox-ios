import hashlib
import json
import plistlib
import struct
import sys
import zipfile
from pathlib import Path


ipa = Path(sys.argv[1]).resolve()
report_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ipa.with_suffix('.verification.json')
with zipfile.ZipFile(ipa) as archive:
    names = archive.namelist()
    apps = {name.split('/')[1] for name in names if name.startswith('Payload/') and len(name.split('/')) > 2}
    assert len(apps) == 1, 'Expected one application in Payload'
    app = 'Payload/' + apps.pop() + '/'
    info = plistlib.loads(archive.read(app + 'Info.plist'))
    assert info['CFBundleIdentifier'] == 'eu.miyomi.waygroundbrowser', 'Wrong bundle identifier'
    assert info['CFBundleDisplayName'] == 'Wayground Browser', 'Wrong app display name'
    assert 'MozDevelopmentTeam' not in info, 'Mozilla Keychain group prefix must not be retained'
    assert not any('.appex/' in name or name.endswith('.appex') for name in names), 'Guest app extensions are unsupported'
    assert int(info['MinimumOSVersion'].split('.')[0]) >= 17, 'Unexpected deployment target'
    with archive.open(app + info['CFBundleExecutable']) as binary:
        header = binary.read(32)
    magic, cpu, subtype, kind = struct.unpack('<Iiii', header[:16])
    assert magic == 0xFEEDFACF and cpu == 0x0100000C and kind == 2, 'Expected an arm64 device executable'
    resources = {}
    for name in ['page.js', 'settings-engine.js', 'options.html', 'options.js', 'mobile.css', 'THIRD_PARTY_NOTICES.txt']:
        data = archive.read(app + 'WaygroundDotsResources/' + name)
        assert data, 'Empty Dots resource: ' + name
        resources[name] = hashlib.sha256(data).hexdigest()
    assert any(name.startswith(app + '_CodeSignature/') for name in names), 'Missing ad-hoc signature'
    assert any(name.startswith(app + 'Frameworks/') for name in names), 'Missing browser frameworks'
with ipa.open('rb') as source:
    digest = hashlib.file_digest(source, 'sha256').hexdigest()
report = {
    'ipa': str(ipa), 'sizeBytes': ipa.stat().st_size,
    'sha256': digest,
    'bundleIdentifier': info['CFBundleIdentifier'], 'minimumIOS': info['MinimumOSVersion'],
    'architecture': 'arm64', 'guestAppExtensions': 0, 'dotsResources': resources,
    'deviceAndLiveContainerTested': False,
}
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
