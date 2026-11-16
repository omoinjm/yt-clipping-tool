"""YouTube Data API v3 upload (private drafts; a human publishes from YouTube Studio)."""

from __future__ import annotations

from pathlib import Path

from .config import settings

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def _credentials():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    token = settings.yt_token_file
    creds = Credentials.from_authorized_user_file(str(token), SCOPES) if token.exists() else None
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    elif not creds or not creds.valid:
        if not settings.yt_client_secrets.exists():
            raise RuntimeError(
                f"missing {settings.yt_client_secrets}: create an OAuth 'Desktop app' client in Google "
                "Cloud Console (YouTube Data API v3 enabled) and download its JSON there"
            )
        flow = InstalledAppFlow.from_client_secrets_file(str(settings.yt_client_secrets), SCOPES)
        creds = flow.run_local_server(port=0, open_browser=False)
    token.write_text(creds.to_json())
    return creds


def build_description(description: str, credit: str | None, tags: list[str]) -> str:
    parts = [description.strip()]
    if credit:
        parts.append(f"Original: {credit}")
    hashtags = " ".join(f"#{t.replace(' ', '')}" for t in tags[:3])
    parts.append(f"#Shorts {hashtags}".strip())
    return "\n\n".join(parts)


def upload(video: Path, title: str, description: str, tags: list[str], privacy: str = "private") -> str:
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    youtube = build("youtube", "v3", credentials=_credentials())
    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": tags[:15],
            "categoryId": settings.yt_category_id,
        },
        "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False},
    }
    media = MediaFileUpload(str(video), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True)
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
    response = None
    while response is None:
        _, response = request.next_chunk()
    return response["id"]
