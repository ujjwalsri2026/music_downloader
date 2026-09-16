"""
spotify_auth.py — Spotify Authentication & Stream Fetching

Uses librespot-python to authenticate with Spotify and fetch encrypted streams.
Supports multiple authentication methods:
1. Username/Password (legacy)
2. OAuth token (recommended)
3. Anonymous (limited quality)
"""

import os
import json
import time
import hashlib
import secrets
from typing import Optional, Tuple, Dict, Any
from pathlib import Path


class SpotifyAuth:
    """Handles Spotify authentication using librespot."""

    # Spotify API endpoints
    SPOTIFY_API = "https://api.spotify.com/v1"
    SPOTIFY_AUTH = "https://accounts.spotify.com"
    SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token"

    def __init__(self, credentials_path: str = "credentials.json"):
        self.credentials_path = Path(credentials_path)
        self.session = None
        self.credentials = self._load_credentials()

    def _load_credentials(self) -> Dict[str, Any]:
        """Load saved credentials from file."""
        if self.credentials_path.exists():
            with open(self.credentials_path, 'r') as f:
                return json.load(f)
        return {}

    def _save_credentials(self, creds: Dict[str, Any]):
        """Save credentials to file."""
        with open(self.credentials_path, 'w') as f:
            json.dump(creds, f, indent=2)
        # Restrict permissions
        os.chmod(self.credentials_path, 0o600)

    def authenticate_username_password(self, username: str, password: str) -> bool:
        """
        Authenticate with username and password (legacy method).

        Args:
            username: Spotify username or email
            password: Spotify password

        Returns:
            True if authentication successful
        """
        try:
            from librespot.core import Session
            from librespot.credentials import UserPassCredentials

            # Build session with credentials
            credentials = UserPassCredentials(username, password)
            self.session = Session.Builder().stored_credential(
                credentials.stored_credential
            ).build()

            # Save session info
            self._save_credentials({
                'method': 'username_password',
                'username': username,
                'session_created': time.time(),
                'session_key': self.session.session_key().hex() if hasattr(self.session, 'session_key') else None
            })

            return True

        except ImportError:
            print("librespot-python not installed. Install with: pip install librespot")
            return False
        except Exception as e:
            print(f"Authentication failed: {e}")
            return False

    def authenticate_anonymous(self) -> bool:
        """
        Authenticate anonymously (limited quality).

        Anonymous sessions get lower quality streams (96kbps OGG).
        """
        try:
            from librespot.core import Session
            from librespot.credentials import AnonymousCredentials

            credentials = AnonymousCredentials()
            self.session = Session.Builder().stored_credential(
                credentials.stored_credential
            ).build()

            self._save_credentials({
                'method': 'anonymous',
                'session_created': time.time(),
                'session_key': self.session.session_key().hex() if hasattr(self.session, 'session_key') else None
            })

            return True

        except ImportError:
            print("librespot-python not installed.")
            return False
        except Exception as e:
            print(f"Anonymous authentication failed: {e}")
            return False

    def authenticate_oauth(self, access_token: str, refresh_token: Optional[str] = None) -> bool:
        """
        Authenticate with OAuth token.

        Args:
            access_token: Spotify access token
            refresh_token: Optional refresh token for token renewal

        Returns:
            True if authentication successful
        """
        try:
            from librespot.core import Session
            from librespot.credentials import OAuthCredentials

            credentials = OAuthCredentials(
                access_token=access_token,
                refresh_token=refresh_token
            )
            self.session = Session.Builder().stored_credential(
                credentials.stored_credential
            ).build()

            self._save_credentials({
                'method': 'oauth',
                'access_token': access_token,
                'refresh_token': refresh_token,
                'session_created': time.time(),
                'session_key': self.session.session_key().hex() if hasattr(self.session, 'session_key') else None
            })

            return True

        except ImportError:
            print("librespot-python not installed.")
            return False
        except Exception as e:
            print(f"OAuth authentication failed: {e}")
            return False

    def get_session_key(self) -> Optional[bytes]:
        """Get the current session key for decryption."""
        if self.session and hasattr(self.session, 'session_key'):
            return self.session.session_key()

        # Try to load from credentials
        if 'session_key' in self.credentials:
            return bytes.fromhex(self.credentials['session_key'])

        return None

    def extract_track_id(self, spotify_url: str) -> Optional[str]:
        """
        Extract track ID from Spotify URL.

        Supports:
        - https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
        - spotify:track:4uLU6hMCjMI75M1A2tKUQC
        """
        import re

        # Standard URL format
        match = re.search(r'open\.spotify\.com/track/([a-zA-Z0-9]+)', spotify_url)
        if match:
            return match.group(1)

        # URI format
        match = re.search(r'spotify:track:([a-zA-Z0-9]+)', spotify_url)
        if match:
            return match.group(1)

        return None

    def get_track_metadata(self, track_id: str) -> Dict[str, Any]:
        """
        Get track metadata from Spotify API.

        Args:
            track_id: Spotify track ID

        Returns:
            Dictionary with track metadata
        """
        if not self.session:
            raise RuntimeError("Not authenticated")

        try:
            from librespot.metadata import TrackId

            track_id_obj = TrackId.from_base62(track_id)
            # Get track info from session
            # This is a simplified version - actual implementation
            # would use the full librespot API
            return {
                'id': track_id,
                'title': 'Unknown',
                'artist': 'Unknown',
                'duration': 0,
                'album': 'Unknown'
            }
        except Exception as e:
            print(f"Failed to get metadata: {e}")
            return {}

    def fetch_encrypted_stream(self, track_id: str, quality: str = 'high') -> Optional[bytes]:
        """
        Fetch encrypted audio stream for a track.

        Args:
            track_id: Spotify track ID
            quality: Audio quality ('normal', 'high', 'very_high')

        Returns:
            Encrypted audio bytes or None
        """
        if not self.session:
            raise RuntimeError("Not authenticated")

        try:
            from librespot.metadata import TrackId
            from librespot.player import Player

            # Map quality to Spotify's internal format
            quality_map = {
                'normal': 'AUDIO_QUALITY_NORMAL',
                'high': 'AUDIO_QUALITY_HIGH',
                'very_high': 'AUDIO_QUALITY_VERY_HIGH'
            }

            track_id_obj = TrackId.from_base62(track_id)

            # Get the track stream
            # Note: This is a simplified version
            # The actual implementation depends on librespot's API
            player = Player(self.session)

            # In a real implementation, you would:
            # 1. Load the track
            # 2. Get the encrypted stream
            # 3. Return the raw bytes

            # For now, return placeholder
            print(f"Fetching track {track_id} with quality {quality}")
            return None

        except Exception as e:
            print(f"Failed to fetch stream: {e}")
            return None

    def download_track(self, track_id: str, output_path: str,
                       quality: str = 'high') -> bool:
        """
        Download and decrypt a track.

        Args:
            track_id: Spotify track ID
            output_path: Path to save decrypted audio
            quality: Audio quality level

        Returns:
            True if successful
        """
        try:
            # Get session key
            session_key = self.get_session_key()
            if not session_key:
                print("No session key available")
                return False

            # Fetch encrypted stream
            encrypted_data = self.fetch_encrypted_stream(track_id, quality)
            if not encrypted_data:
                print("Failed to fetch encrypted stream")
                return False

            # Decrypt
            from decryptor import SpotifyDecryptor
            decryptor = SpotifyDecryptor(session_key, quality)
            decrypted_data = decryptor.decrypt_stream(encrypted_data)

            # Save
            with open(output_path, 'wb') as f:
                f.write(decrypted_data)

            return True

        except Exception as e:
            print(f"Download failed: {e}")
            return False


class SpotifyAPI:
    """Spotify Web API client for metadata and search."""

    def __init__(self, access_token: Optional[str] = None):
        self.access_token = access_token
        self.base_url = "https://api.spotify.com/v1"

    def _make_request(self, endpoint: str) -> Dict[str, Any]:
        """Make authenticated request to Spotify API."""
        import requests

        headers = {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json'
        }

        response = requests.get(f"{self.base_url}{endpoint}", headers=headers)
        response.raise_for_status()
        return response.json()

    def get_track(self, track_id: str) -> Dict[str, Any]:
        """Get track metadata."""
        return self._make_request(f"/tracks/{track_id}")

    def search(self, query: str, limit: int = 5) -> Dict[str, Any]:
        """Search for tracks."""
        import requests
        import urllib.parse

        params = {
            'q': query,
            'type': 'track',
            'limit': limit
        }

        headers = {
            'Authorization': f'Bearer {self.access_token}'
        }

        response = requests.get(
            f"{self.base_url}/search",
            headers=headers,
            params=params
        )
        response.raise_for_status()
        return response.json()

    def get_track_audio_features(self, track_id: str) -> Dict[str, Any]:
        """Get audio features for a track."""
        return self._make_request(f"/audio-features/{track_id}")


# Convenience function
def create_spotify_client(method: str = 'anonymous', **kwargs) -> SpotifyAuth:
    """
    Create a Spotify client with the specified authentication method.

    Args:
        method: Authentication method ('anonymous', 'username_password', 'oauth')
        **kwargs: Authentication credentials

    Returns:
        Authenticated SpotifyAuth instance
    """
    auth = SpotifyAuth()

    if method == 'anonymous':
        auth.authenticate_anonymous()
    elif method == 'username_password':
        auth.authenticate_username_password(
            kwargs.get('username', ''),
            kwargs.get('password', '')
        )
    elif method == 'oauth':
        auth.authenticate_oauth(
            kwargs.get('access_token', ''),
            kwargs.get('refresh_token')
        )
    else:
        raise ValueError(f"Unknown authentication method: {method}")

    return auth


# Test function
def test_auth():
    """Test authentication with anonymous method."""
    print("Spotify Auth Test")
    print("=" * 50)

    auth = SpotifyAuth()
    print("Attempting anonymous authentication...")

    if auth.authenticate_anonymous():
        print("✓ Anonymous authentication successful")
        session_key = auth.get_session_key()
        if session_key:
            print(f"✓ Session key obtained: {len(session_key)} bytes")
        else:
            print("✗ No session key")
    else:
        print("✗ Authentication failed")

    print("\nNote: For full functionality, install librespot-python:")
    print("pip install librespot")


if __name__ == "__main__":
    test_auth()
