from app.shopping import _first_listing_price, _measurement


def test_measurement_converts_supported_units_to_meters():
    assert _measurement({"displayValue": 20, "unit": "inches"}) == 0.508
    assert _measurement({"displayValue": 150, "unit": "centimeters"}) == 1.5
    assert _measurement({"displayValue": 2, "unit": "unknown"}) is None


def test_offer_price_is_normalized_to_cents():
    item = {"offersV2": {"listings": [{"price": {"money": {"amount": 49.99}}}]}}
    assert _first_listing_price(item) == 4999
    assert _first_listing_price({}) is None
