"""
decryptor.py — Spotify AES-128-CTR Audio Decryption

Spotify encrypts audio streams using AES-128-CTR.
This module provides decryption for cached Spotify audio files.

Key derivation:
- session_key: 32 bytes from Spotify's key exchange
- AES key: first 16 bytes of session_key
- IV/nonce: next 16 bytes of session_key
- Counter: incremented per 16-byte block

Note: For actual Spotify downloads, use spotdl or spotify-dl
which handle authentication and decryption automatically.
This module is for decrypting manually cached .ogx files.
"""

import struct
from typing import Optional, Tuple


class SpotifyDecryptor:
    """Decrypts Spotify encrypted audio streams using AES-128-CTR."""

    def __init__(self, session_key: bytes, quality: str = 'high'):
        if len(session_key) < 32:
            raise ValueError(f"Session key must be at least 32 bytes, got {len(session_key)}")

        self.key = session_key[:16]
        self.iv_base = session_key[16:32]
        self.quality = quality

    def _derive_iv(self, chunk_number: int) -> bytes:
        """Derive IV for a specific chunk by XORing counter into base IV."""
        iv = bytearray(self.iv_base)
        counter = chunk_number
        for i in range(7, -1, -1):
            iv[8 + i] ^= (counter & 0xFF)
            counter >>= 8
        return bytes(iv)

    def decrypt_chunk(self, encrypted_chunk: bytes, chunk_number: int) -> bytes:
        """Decrypt a single chunk of audio data."""
        try:
            from Crypto.Cipher import AES
        except ImportError:
            raise ImportError("pycryptodome required: pip install pycryptodome")

        iv = self._derive_iv(chunk_number)
        cipher = AES.new(self.key, AES.MODE_ECB)
        result = bytearray()
        block_size = 16

        for i in range(0, len(encrypted_chunk), block_size):
            keystream = cipher.encrypt(iv)
            block = encrypted_chunk[i:i + block_size]
            result.extend(b ^ k for b, k in zip(block, keystream))
            iv = self._increment_counter(iv)

        return bytes(result)

    def _increment_counter(self, iv: bytes) -> bytes:
        """Increment the counter portion of the IV (last 8 bytes)."""
        iv = bytearray(iv)
        for i in range(15, 7, -1):
            iv[i] = (iv[i] + 1) & 0xFF
            if iv[i] != 0:
                break
        return bytes(iv)

    def decrypt_stream(self, encrypted_stream: bytes) -> bytes:
        """Decrypt an in-memory encrypted audio stream."""
        chunk_size = 320 * 1024  # 320KB chunks
        decrypted = bytearray()
        chunk_num = 0

        for i in range(0, len(encrypted_stream), chunk_size):
            chunk = encrypted_stream[i:i + chunk_size]
            decrypted.extend(self.decrypt_chunk(chunk, chunk_num))
            chunk_num += 1

        return bytes(decrypted)

    def decrypt_file(self, encrypted_path: str, output_path: Optional[str] = None) -> bytes:
        """Decrypt an entire encrypted audio file."""
        with open(encrypted_path, 'rb') as f:
            data = f.read()

        decrypted = self.decrypt_stream(data)

        if output_path:
            with open(output_path, 'wb') as f:
                f.write(decrypted)

        return decrypted


def is_valid_ogg(data: bytes) -> bool:
    """Check if data starts with OGG magic bytes."""
    return data[:4] == b'OggS'


def decrypt_spotify_audio(encrypted_data: bytes, session_key: bytes, quality: str = 'high') -> bytes:
    """Convenience function to decrypt Spotify audio."""
    decryptor = SpotifyDecryptor(session_key, quality)
    return decryptor.decrypt_stream(encrypted_data)
