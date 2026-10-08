import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

key = ec.generate_private_key(ec.SECP256R1())

private_der = key.private_bytes(
    serialization.Encoding.DER,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
public_raw = key.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint,
)

print("Добавь в .env:\n")
print(f"VAPID_PRIVATE_KEY={base64.urlsafe_b64encode(private_der).decode()}")
print(f"VAPID_PUBLIC_KEY={base64.urlsafe_b64encode(public_raw).rstrip(b'=').decode()}")
print("VAPID_SUBJECT=mailto:vadimram8@gmail.com")