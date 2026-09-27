from __future__ import annotations

import json
import re
import textwrap
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from jwcrypto import jwe, jwk

from .settings import Settings


class VisaR2PError(RuntimeError):
    """A safe error from the Visa Request to Pay boundary."""


STATUS_MAP = {
    "PDNG": "pending",
    "RCVD": "pending",
    "ACSC": "completed",
    "ASCS": "completed",
    "ACCP": "accepted",
    "RJCT": "rejected",
    "CNCL": "cancelled",
    "EXPD": "cancelled",
}


def _pem_bytes(path: Path) -> bytes:
    """Read normal PEMs and Visa sandbox downloads compressed onto one line."""
    raw = path.read_text(encoding="utf-8").strip()
    if "\n" in raw:
        return f"{raw}\n".encode()
    match = re.fullmatch(r"(-----BEGIN [A-Z ]+-----)(.+)(-----END [A-Z ]+-----)", raw)
    if not match:
        raise VisaR2PError(f"{path.name} is not a valid PEM file.")
    header, payload, footer = match.groups()
    payload = "".join(payload.split())
    return f"{header}\n{'\n'.join(textwrap.wrap(payload, 64))}\n{footer}\n".encode()


def _name_parts(name: str) -> tuple[str, str]:
    parts = name.strip().split(maxsplit=1)
    last_initial = parts[1][0] if len(parts) > 1 and parts[1] else parts[0][0]
    return parts[0][:140], f"{last_initial.upper()}."


class VisaR2PClient:
    RESOURCE = "/rtx/api/v1/requestToPay"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def mode(self) -> str:
        return "sandbox" if self.settings.visa_r2p_mode == "sandbox" else "demo"

    @property
    def configured(self) -> bool:
        required = (
            self.settings.visa_r2p_username,
            self.settings.visa_r2p_password,
            self.settings.visa_r2p_client_cert,
            self.settings.visa_r2p_client_key,
            self.settings.visa_r2p_mle_key_id,
            self.settings.visa_r2p_mle_server_cert,
            self.settings.visa_r2p_mle_private_key,
            self.settings.visa_r2p_creditor_agent_id,
            self.settings.visa_r2p_debtor_agent_id,
            self.settings.visa_r2p_settlement_pan,
        )
        pan = self.settings.visa_r2p_settlement_pan or ""
        return self.mode == "sandbox" and all(required) and pan.isdigit() and 13 <= len(pan) <= 19 and all(not isinstance(value, Path) or value.is_file() for value in required)

    def public_status(self) -> dict[str, Any]:
        return {
            "provider": "visa_direct_request_to_pay",
            "mode": self.mode,
            "configured": self.configured,
            "message": "Visa sandbox credentials are configured." if self.configured else ("Visa sandbox configuration is incomplete." if self.mode == "sandbox" else "Demo mode uses Visa-shaped request states without moving money."),
        }

    def _encrypt(self, payload: dict[str, Any]) -> dict[str, str]:
        cert_path = self.settings.visa_r2p_mle_server_cert
        key_id = self.settings.visa_r2p_mle_key_id
        if not cert_path or not key_id:
            raise VisaR2PError("Visa MLE encryption is not configured.")
        recipient = jwk.JWK.from_pem(_pem_bytes(cert_path))
        protected = {"alg": "RSA-OAEP-256", "enc": "A128GCM", "kid": key_id, "iat": int(time.time() * 1000)}
        token = jwe.JWE(json.dumps(payload, separators=(",", ":")).encode(), recipient=recipient, protected=protected)
        return {"encData": token.serialize(compact=True)}

    def _decrypt(self, payload: dict[str, Any]) -> dict[str, Any]:
        encoded = payload.get("encData")
        if not isinstance(encoded, str):
            return payload
        key_path = self.settings.visa_r2p_mle_private_key
        if not key_path:
            raise VisaR2PError("Visa MLE response decryption is not configured.")
        token = jwe.JWE()
        token.deserialize(encoded, key=jwk.JWK.from_pem(_pem_bytes(key_path)))
        return json.loads(token.payload.decode())

    def _http(self) -> httpx.AsyncClient:
        if not self.configured:
            raise VisaR2PError("Visa sandbox credentials are incomplete. Switch to demo mode or configure every VISA_R2P value.")
        return httpx.AsyncClient(
            base_url=self.settings.visa_r2p_base_url,
            auth=(self.settings.visa_r2p_username or "", self.settings.visa_r2p_password or ""),
            cert=(str(self.settings.visa_r2p_client_cert), str(self.settings.visa_r2p_client_key)),
            timeout=30,
        )

    def _payload(self, *, transfer: dict[str, Any], creditor: dict[str, Any], debtor: dict[str, Any], creditor_alias: str, debtor_alias: str, alias_type: str) -> dict[str, Any]:
        creditor_first, creditor_last = _name_parts(creditor["name"])
        debtor_first, debtor_last = _name_parts(debtor["name"])
        today = date.today()
        # Visa's debtor simulator parses four underscore-separated scenario fields.
        # X_2_X_X means no intermediate state, settle successfully, preserve the
        # request's settlement rail, and do not issue a refund.
        scenario = self.settings.visa_r2p_simulator_scenario if self.mode == "sandbox" else "X_2_X_X"
        if scenario not in {"X_1_X_X", "X_2_X_X", "X_3_X_X", "X_4_X_X", "A_2_X_X", "B_2_X_X", "AB_2_X_X"}:
            raise VisaR2PError("VISA_R2P_SIMULATOR_SCENARIO is not an allowed Roominate sandbox scenario.")
        return {
            "requestMessageId": f"ROOM{uuid.uuid4().hex[:16].upper()}",
            "creationDateTime": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "product": "VD",
            "useCase": "P2P",
            "dueDate": (today + timedelta(days=7)).isoformat(),
            "creditor": {
                "creditorFirstName": creditor_first,
                "creditorLastName": creditor_last,
                "creditorAlias": creditor_alias,
                "creditorAliasType": alias_type,
                "creditorId": creditor["id"][:35],
                "creditorIdType": "AGENT",
                "creditorCountry": self.settings.visa_r2p_country,
                "creditorAgentId": self.settings.visa_r2p_creditor_agent_id or "ROOMINATE-DEMO",
                "creditorAgentCountry": self.settings.visa_r2p_country,
            },
            "paymentRequests": [{
                "endToEndId": f"{scenario}_{uuid.uuid4().hex[:8]}",
                "debtorFirstName": debtor_first,
                "debtorLastName": debtor_last,
                "debtorAlias": debtor_alias,
                "debtorAliasType": alias_type,
                "debtorAgentId": self.settings.visa_r2p_debtor_agent_id or "ROOMINATE-DEMO",
                "debtorAgentCountry": self.settings.visa_r2p_country,
                "debtorCountry": self.settings.visa_r2p_country,
                "requestedAmount": round(transfer["amount_cents"] / 100, 2),
                "requestedAmountCurrency": "USD",
            }],
            "settlementOptions": [{
                "settlementSystem": "VISA_DIRECT",
                "primaryAccountNumber": self.settings.visa_r2p_settlement_pan or "4111111111111111",
            }],
            "requestReason": {
                "message": f"Roominate shared room expenses: {transfer['description']}"[:250],
            },
        }

    async def initiate(self, *, transfer: dict[str, Any], creditor: dict[str, Any], debtor: dict[str, Any], creditor_alias: str, debtor_alias: str, alias_type: str) -> dict[str, Any]:
        payload = self._payload(transfer=transfer, creditor=creditor, debtor=debtor, creditor_alias=creditor_alias, debtor_alias=debtor_alias, alias_type=alias_type)
        if self.mode == "demo":
            return {"provider_request_id": f"demo-{uuid.uuid4()}", "affinity": None, "status": "pending", "raw": {"transactionStatus": "PDNG", "demo": True}}
        async with self._http() as client:
            response = await client.post(self.RESOURCE, headers={"keyID": self.settings.visa_r2p_mle_key_id or "", "Accept": "application/json"}, json=self._encrypt(payload))
        if response.status_code >= 400:
            raise VisaR2PError(f"Visa sandbox rejected the request ({response.status_code}). Check the Visa project test data and onboarding IDs.")
        body = self._decrypt(response.json())
        payment = (body.get("paymentRequests") or [{}])[0]
        payment_request_id = body.get("paymentRequestId") or payment.get("paymentRequestId")
        if not payment_request_id:
            raise VisaR2PError("Visa returned no payment request ID.")
        code = str(body.get("transactionStatus") or payment.get("transactionStatus") or "PDNG")
        return {"provider_request_id": str(payment_request_id), "affinity": response.headers.get("x-request-affinity"), "status": STATUS_MAP.get(code, "pending"), "raw": body}

    async def retrieve(self, provider_request_id: str, affinity: str | None) -> dict[str, Any]:
        if self.mode == "demo":
            return {"status": "pending", "raw": {"transactionStatus": "PDNG", "demo": True}}
        headers = {"keyID": self.settings.visa_r2p_mle_key_id or "", "Accept": "application/json"}
        if affinity:
            headers["x-request-affinity"] = affinity
        async with self._http() as client:
            response = await client.get(f"{self.RESOURCE}/{provider_request_id}", headers=headers)
        if response.status_code >= 400:
            raise VisaR2PError(f"Visa sandbox could not retrieve the request ({response.status_code}).")
        body = self._decrypt(response.json())
        code = str(body.get("transactionStatus") or "PDNG")
        return {"status": STATUS_MAP.get(code, "pending"), "raw": body}


__all__ = ["VisaR2PClient", "VisaR2PError"]
