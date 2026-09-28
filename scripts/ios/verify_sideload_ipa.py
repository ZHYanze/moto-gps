#!/usr/bin/env python3
"""Validate distribution structure and privacy-sensitive packaging boundaries."""
import plistlib
import struct
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    names = archive.namelist()
    info_paths = [p for p in names if p.startswith('Payload/') and p.count('/') == 2 and p.endswith('.app/Info.plist')]
    assert len(info_paths) == 1, 'Expected one iPhone application'
    info_path = info_paths[0]
    root = info_path.removesuffix('Info.plist')
    info = plistlib.loads(archive.read(info_path))
    assert info['CFBundlePackageType'] == 'APPL'
    assert info['CFBundleSupportedPlatforms'] == ['iPhoneOS'], 'Must be a device build'
    assert info['MOTOGPSGatewayBaseURL'] == 'https://example.invalid/moto-gps/api/', 'Do not ship a private gateway'
    assert {'location', 'bluetooth-central'} <= set(info['UIBackgroundModes'])
    assert not any(p.endswith(('embedded.mobileprovision', '.p12', '.p8', '.pem')) or '/_CodeSignature/' in p for p in names), 'Signing credentials/profile must not be distributed'
    for name in ['NSBluetoothAlwaysUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription', 'NSLocationWhenInUseUsageDescription']:
        assert info.get(name), name
    for resource in ['PrivacyInfo.xcprivacy', 'NOTICE', 'LICENSE.md', 'THIRD_PARTY_NOTICES.md', 'jinan-v1.sqlite']:
        assert root + resource in names, f'Missing {resource}'
    binary = archive.read(root + info['CFBundleExecutable'])
    magic, cpu = struct.unpack_from('<II', binary)
    assert magic == 0xFEEDFACF and cpu == 0x0100000C, 'Expected arm64 Mach-O'
    commands = struct.unpack_from('<I', binary, 16)[0]
    offset = 32
    for _ in range(commands):
        command, size = struct.unpack_from('<II', binary, offset)
        assert size >= 8
        if command == 0x2C:  # LC_ENCRYPTION_INFO_64
            assert struct.unpack_from('<I', binary, offset + 16)[0] == 0, 'IPA must be unencrypted for re-signing'
        offset += size
    print(f"Verified unsigned arm64 IPA {info['CFBundleShortVersionString']} ({info['CFBundleVersion']})")
