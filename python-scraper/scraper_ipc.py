import sys
import json
import threading
import queue
import datetime
from instagrapi import Client
from instagrapi.exceptions import (
    BadPassword,
    TwoFactorRequired,
    ChallengeRequired,
    FeedbackRequired,
    ClientError,
    ClientConnectionError
)
import yt_dlp

# Thread-safe commands queue and verification events
command_queue = queue.Queue()
verification_event = threading.Event()
verification_code = None

client = Client()

# Monkeypatch instagrapi to prevent friendship_status validation errors
try:
    original_private_request = Client.private_request

    def sanitize_friendship_status(obj):
        if isinstance(obj, dict):
            if "friendship_status" in obj:
                obj["friendship_status"] = None
            for key, value in obj.items():
                sanitize_friendship_status(value)
        elif isinstance(obj, list):
            for item in obj:
                sanitize_friendship_status(item)

    def patched_private_request(*args, **kwargs):
        result = original_private_request(*args, **kwargs)
        try:
            sanitize_friendship_status(result)
        except Exception:
            pass
        return result

    Client.private_request = patched_private_request
except Exception:
    pass

def handle_two_factor(username):
    global verification_code
    # Notify Rust that 2FA is required
    print(json.dumps({"type": "event", "event": "2fa_required", "username": username}))
    sys.stdout.flush()
    
    # Wait for Rust to submit the code
    verification_event.clear()
    verification_code = None
    success = verification_event.wait(timeout=300.0)
    if not success or not verification_code:
        raise Exception("Two-factor authentication timed out or cancelled.")
    return verification_code

def handle_challenge_code(username, choice):
    global verification_code
    # Notify Rust that a security checkpoint is required
    print(json.dumps({"type": "event", "event": "challenge_required", "username": username, "choice": choice}))
    sys.stdout.flush()
    
    # Wait for Rust to submit the code
    verification_event.clear()
    verification_code = None
    success = verification_event.wait(timeout=300.0)
    if not success or not verification_code:
        raise Exception("Challenge verification timed out or cancelled.")
    return verification_code

# Register handlers
client.two_factor_handler = handle_two_factor
client.challenge_code_handler = handle_challenge_code

def _determine_media_type(media) -> str:
    # 1 = Photo, 2 = Video, 8 = Album
    if media.media_type == 8:
        return "CAROUSEL"
    elif media.media_type == 2:
        if media.product_type == "clips":
            return "REEL"
        elif media.product_type == "igtv":
            return "IGTV"
        else:
            return "POST"
    return "POST"

def _parse_media_to_dict(media) -> dict:
    media_type = _determine_media_type(media)
    
    thumbnail_url = ""
    if media.thumbnail_url:
        thumbnail_url = str(media.thumbnail_url)
    elif media.resources and media.resources[0].thumbnail_url:
        thumbnail_url = str(media.resources[0].thumbnail_url)
        
    video_url = ""
    if media.video_url:
        video_url = str(media.video_url)
        
    resources_list = []
    if media.media_type == 8 and media.resources:
        for res in media.resources:
            res_type = "POST"
            if res.media_type == 2:
                res_type = "REEL"
            
            resources_list.append({
                "pk": res.pk,
                "media_type": res_type,
                "thumbnail_url": str(res.thumbnail_url) if res.thumbnail_url else "",
                "video_url": str(res.video_url) if res.video_url else ""
            })
            
    taken_at_str = media.taken_at.isoformat() if media.taken_at else datetime.datetime.now(datetime.timezone.utc).isoformat()
    caption_str = media.caption_text[:100] if media.caption_text else ""
    
    return {
        "media_id": media.id,
        "media_type": media_type,
        "username": media.user.username.lower(),
        "full_name": media.user.full_name,
        "taken_at": taken_at_str,
        "caption": caption_str,
        "thumbnail_url": thumbnail_url,
        "video_url": video_url,
        "resources_json": json.dumps(resources_list),
        "like_count": media.like_count or 0,
        "comment_count": media.comment_count or 0,
        "scraped_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

def do_login(params):
    username = params.get("username").strip().lower()
    password = params.get("password", "")
    session_settings = params.get("session_settings")
    
    if session_settings:
        try:
            client.set_settings(session_settings)
            if client.user_id:
                try:
                    # Verify session is still valid with a lightweight request
                    client.user_info(client.user_id)
                    return {"status": "success", "session_settings": client.get_settings()}
                except Exception:
                    # Session expired or invalid, fall through to login
                    pass
        except Exception:
            pass
            
    # Try logging in
    client.login(username, password)
    return {"status": "success", "session_settings": client.get_settings()}

def do_scrape_saved(params):
    max_id = params.get("max_id", "")
    medias, next_cursor = client.collection_medias_v1_chunk("saved", max_id=max_id)
    
    parsed_items = [_parse_media_to_dict(m) for m in medias]
    return {
        "status": "success",
        "items": parsed_items,
        "next_max_id": next_cursor or ""
    }

def do_resolve_fallback(params):
    media_id = params.get("media_id")
    pk = media_id.split("_")[0]
    code = client.media_code_from_pk(pk)
    post_url = f"https://www.instagram.com/p/{code}/"
    
    ydl_opts = {
        "format": "best",
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(post_url, download=False)
        urls = []
        if "entries" in info:
            for entry in info["entries"]:
                if entry.get("url"):
                    urls.append(entry["url"])
        elif info.get("url"):
            urls.append(info["url"])
            
    return {"status": "success", "urls": urls}

def do_refresh_media(params):
    media_id = params.get("media_id")
    pk = media_id.split("_")[0]
    media_info = client.media_info(pk)
    parsed = _parse_media_to_dict(media_info)
    return {"status": "success", "media": parsed}

def stdin_reader():
    global verification_code
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            if msg.get("method") == "submit_otp":
                verification_code = msg.get("params", {}).get("code")
                verification_event.set()
            else:
                command_queue.put(msg)
        except Exception as e:
            print(json.dumps({"type": "response", "status": "error", "message": f"Stdin parse error: {e}"}))
            sys.stdout.flush()

# Start reading thread
t = threading.Thread(target=stdin_reader, daemon=True)
t.start()

# Main command dispatcher loop
while True:
    try:
        cmd = command_queue.get()
        method = cmd.get("method")
        params = cmd.get("params", {})
        msg_id = cmd.get("id")
        
        result = None
        if method == "login":
            result = do_login(params)
        elif method == "scrape_saved":
            result = do_scrape_saved(params)
        elif method == "resolve_fallback":
            result = do_resolve_fallback(params)
        elif method == "refresh_media":
            result = do_refresh_media(params)
        else:
            result = {"status": "error", "message": f"Unknown method: {method}"}
            
        # Send response back with matching ID
        response = {"type": "response", "id": msg_id, "result": result}
        print(json.dumps(response))
        sys.stdout.flush()
        
    except Exception as e:
        # Map custom exceptions to strings
        err_msg = str(e)
        response = {"type": "response", "id": msg_id, "result": {"status": "error", "message": err_msg}}
        print(json.dumps(response))
        sys.stdout.flush()
