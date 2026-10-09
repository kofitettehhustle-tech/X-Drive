# X Drive API Reference

## Base URL
```
http://localhost:3187
```

## Service Catalog

### Get All Services
**Endpoint:** `GET /api/storefront/catalog`

**Response:**
```json
{
  "source": "morethanpanel",
  "updatedAt": "2026-10-09T12:00:00.000Z",
  "services": [
    {
      "id": "xd-abc123...",
      "platform": "Instagram",
      "title": "Instagram Followers - Real & Active",
      "category": "Followers",
      "description": "Followers for Instagram",
      "pricePer1000": 2.50,
      "minimum": 100,
      "maximum": 100000,
      "refillable": true,
      "deliveryEstimate": "",
      "enabled": true
    }
  ]
}
```

---

## Order Management

### Create Order
**Endpoint:** `POST /api/storefront/orders`

**Request Body:**
```json
{
  "serviceId": "xd-abc123...",
  "link": "https://instagram.com/username",
  "quantity": 1000,
  "customerEmail": "customer@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "xd-order-def456...",
    "providerOrderId": "123456",
    "customerEmail": "customer@example.com",
    "serviceId": "xd-abc123...",
    "serviceTitle": "Instagram Followers",
    "platform": "Instagram",
    "link": "https://instagram.com/username",
    "quantity": 1000,
    "charge": 2.50,
    "startCount": 5000,
    "remains": 1000,
    "status": "Processing",
    "createdAt": "2026-10-09T12:00:00.000Z",
    "updatedAt": "2026-10-09T12:00:00.000Z",
    "refillable": true,
    "refillId": null,
    "refillStatus": null,
    "cancelRequested": false
  }
}
```

---

### Get Order Status
**Endpoint:** `GET /api/storefront/orders/:orderId`

**Response:**
```json
{
  "order": {
    "id": "xd-order-def456...",
    "providerOrderId": "123456",
    "status": "In progress",
    "startCount": 5000,
    "remains": 500,
    "quantity": 1000,
    "charge": 2.50,
    "createdAt": "2026-10-09T12:00:00.000Z",
    "updatedAt": "2026-10-09T12:05:00.000Z"
  }
}
```

**Order Status Values:**
- `Pending` - Order submitted, waiting to start
- `Processing` - Order is being prepared
- `In progress` - Order is actively being delivered
- `Completed` - Order finished successfully
- `Partial` - Order partially completed
- `Canceled` - Order was canceled
- `Refunded` - Order was refunded

---

### Get Customer Orders
**Endpoint:** `GET /api/storefront/orders?email=customer@example.com`

**Response:**
```json
{
  "orders": [
    {
      "id": "xd-order-def456...",
      "serviceTitle": "Instagram Followers",
      "platform": "Instagram",
      "quantity": 1000,
      "charge": 2.50,
      "status": "Completed",
      "createdAt": "2026-10-09T12:00:00.000Z"
    }
  ]
}
```

---

### Get Order History
**Endpoint:** `GET /api/storefront/orders/:orderId/history`

**Response:**
```json
{
  "history": [
    {
      "status": "Completed",
      "remains": 0,
      "startCount": 5000,
      "recordedAt": "2026-10-09T12:10:00.000Z"
    },
    {
      "status": "In progress",
      "remains": 500,
      "startCount": 5000,
      "recordedAt": "2026-10-09T12:05:00.000Z"
    },
    {
      "status": "Processing",
      "remains": 1000,
      "startCount": 5000,
      "recordedAt": "2026-10-09T12:00:00.000Z"
    }
  ]
}
```

---

### Request Refill
**Endpoint:** `POST /api/storefront/orders/:orderId/refill`

**Response:**
```json
{
  "success": true,
  "refill": {
    "refill": "789",
    "status": "Refill request received"
  }
}
```

**Requirements:**
- Order must be marked as refillable
- Order must be completed
- Must have provider order ID

---

### Cancel Order
**Endpoint:** `POST /api/storefront/orders/:orderId/cancel`

**Response:**
```json
{
  "success": true,
  "cancel": {
    "status": "Cancellation requested"
  }
}
```

**Requirements:**
- Order cannot be Completed, Canceled, or Refunded
- Must have provider order ID

---

## Admin Endpoints

### Get Balance
**Endpoint:** `GET /api/admin/balance`

**Response:**
```json
{
  "balance": {
    "balance": "1234.56",
    "currency": "USD"
  }
}
```

---

### Sync Services
**Endpoint:** `POST /api/admin/sync-services`

**Response:**
```json
{
  "success": true,
  "message": "Services synchronized successfully",
  "serviceCount": 3285
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message description"
}
```

**Common HTTP Status Codes:**
- `400` - Bad Request (missing/invalid parameters)
- `404` - Not Found (order/service doesn't exist)
- `500` - Internal Server Error
- `503` - Service Unavailable (catalog not loaded)

---

## Rate Limits

No rate limits currently enforced. However, Morethanpanel may have their own rate limits.

---

## Webhook Support

Webhooks are not currently implemented. Order status must be polled via GET requests.

---

## CORS

CORS is enabled for all origins in development. Configure appropriately for production.

---

## Authentication

No authentication required for public endpoints. Admin endpoints should be protected in production.
