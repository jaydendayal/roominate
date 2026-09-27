from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from app import main
from app.visa_r2p import VisaR2PClient
from app.store import SettlementStore


def _payload() -> dict:
    return {
        "project_id": "project-demo",
        "currency": "USD",
        "people": [{"id": "jay", "name": "Jay"}, {"id": "maya", "name": "Maya"}],
        "expenses": [
            {"item_id": "desk", "label": "Desk", "paid_by_person_id": "jay", "amount_cents": 10001},
            {"item_id": "lamp", "label": "Lamp", "paid_by_person_id": "maya", "amount_cents": 2999},
        ],
    }


def test_settlement_preview_conserves_exact_cents(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "settlement_store", SettlementStore(tmp_path / "settlements.sqlite"))
    client = TestClient(main.app)
    response = client.post("/api/v1/settlements/preview", json=_payload())
    assert response.status_code == 200
    result = response.json()
    assert result["total_cents"] == 13000
    assert result["calculation"] == "equal_split_exact_cents"
    assert result["transfers"] == [{
        "id": "transfer-1",
        "debtor_id": "maya",
        "debtor_name": "Maya",
        "creditor_id": "jay",
        "creditor_name": "Jay",
        "amount_cents": 3501,
        "description": "equal share of 2 confirmed room purchases",
    }]


def test_demo_request_uses_stored_amount_and_can_complete(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "settlement_store", SettlementStore(tmp_path / "settlements.sqlite"))
    client = TestClient(main.app)
    preview = client.post("/api/v1/settlements/preview", json=_payload()).json()
    created = client.post(
        f"/api/v1/settlements/{preview['id']}/requests",
        json={"transfer_id": "transfer-1", "creditor_alias": "+15551110000", "debtor_alias": "+15552220000", "alias_type": "MOBL"},
    )
    assert created.status_code == 200
    request = created.json()
    assert request["amount_cents"] == 3501
    assert request["status"] == "pending"
    assert request["creditor_alias"] == "+1••••00"

    completed = client.post(f"/api/v1/payment-requests/{request['id']}/demo-decision", json={"decision": "accept"})
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"


def test_settlement_rejects_unknown_payer() -> None:
    payload = _payload()
    payload["expenses"][0]["paid_by_person_id"] = "stranger"
    response = TestClient(main.app).post("/api/v1/settlements/preview", json=payload)
    assert response.status_code == 422


def test_visa_payload_matches_initiate_r2p_contract() -> None:
    settings = replace(
        main.settings,
        visa_r2p_mode="sandbox",
        visa_r2p_creditor_agent_id="CREDITOR-AGENT",
        visa_r2p_debtor_agent_id="DEBTOR-AGENT",
        visa_r2p_settlement_pan="4111111111111111",
        visa_r2p_simulator_scenario="X_2_X_X",
    )
    payload = VisaR2PClient(settings)._payload(
        transfer={"amount_cents": 3501, "description": "equal share of confirmed purchases"},
        creditor={"id": "jay", "name": "Jay Dayal"},
        debtor={"id": "maya", "name": "Maya Roommate"},
        creditor_alias="jay@example.com",
        debtor_alias="maya@example.com",
        alias_type="EMAIL",
    )

    assert VisaR2PClient.RESOURCE == "/rtx/api/v1/requestToPay"
    assert payload["creditor"]["creditorLastName"] == "D."
    assert payload["creditor"]["creditorIdType"] == "AGENT"
    assert payload["paymentRequests"][0]["debtorLastName"] == "R."
    assert payload["paymentRequests"][0]["requestedAmount"] == 35.01
    assert payload["paymentRequests"][0]["debtorAliasType"] == "EMAIL"
    assert payload["paymentRequests"][0]["endToEndId"].startswith("X_2_X_X_")
    assert payload["settlementOptions"] == [{"settlementSystem": "VISA_DIRECT", "primaryAccountNumber": "4111111111111111"}]
    assert payload["requestReason"]["message"].startswith("Roominate shared room expenses")
