"""Ed25519 signing of the pack index.

The private key lives in keys/pack-index.key (gitignored). The public key is
committed as keys/pack-index.pub and embedded in the app, which verifies the
signature over the exact bytes of index.json before trusting any SHA-256 in it.
"""

import base64
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .paths import KEYS

PRIVATE = KEYS / "pack-index.key"
PUBLIC = KEYS / "pack-index.pub"


def load_or_create_key(private: Path = PRIVATE, public: Path = PUBLIC) -> Ed25519PrivateKey:
    private.parent.mkdir(exist_ok=True)
    if private.exists():
        return serialization.load_pem_private_key(private.read_bytes(), password=None)
    key = Ed25519PrivateKey.generate()
    private.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    private.chmod(0o600)
    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    public.write_text(base64.b64encode(raw).decode() + "\n")
    print(f"Generated a new signing key; public key in {public}")
    return key


def sign(data: bytes, private: Path = PRIVATE, public: Path = PUBLIC) -> str:
    return base64.b64encode(load_or_create_key(private, public).sign(data)).decode()
