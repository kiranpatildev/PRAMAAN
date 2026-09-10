"""WebSocket alerts channel (Phase 7): ws/alerts/?token=<jwt-access>.

JWT (not session/cookie) auth because the SPA holds tokens in localStorage.
Each authenticated socket joins exactly one group: user_{id}.
"""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer


@database_sync_to_async
def _user_for_token(token: str):
    try:
        from rest_framework_simplejwt.tokens import UntypedToken
        from apps.accounts.models import User
        data = UntypedToken(token)
        return User.objects.filter(pk=data["user_id"]).first()
    except Exception:
        return None


class AlertsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = self.scope.get("query_string", b"").decode()
        token = ""
        for part in query.split("&"):
            if part.startswith("token="):
                token = part[len("token="):]
                break
        user = await _user_for_token(token) if token else None
        if user is None:
            await self.close(code=4401)
            return
        self.group = f"user_{user.id}"
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "hello", "message": "alerts channel ready"})

    async def disconnect(self, code):
        if hasattr(self, "group"):
            try:
                await self.channel_layer.group_discard(self.group, self.channel_name)
            except Exception:
                pass

    async def alert_message(self, event):
        await self.send_json({"type": "alert", **event.get("data", {})})
