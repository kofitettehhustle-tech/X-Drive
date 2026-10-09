# Morethanpanel API Integration - Complete Documentation

## Overview
Your X Drive storefront is now fully integrated with Morethanpanel API v2, featuring:
- **3,285+ services** automatically synced from Morethanpanel
- **50% markup** applied to all prices
- Real-time order creation and tracking
- Order refills and cancellations
- Balance monitoring
- Complete order history

## ✅ What's Been Integrated

### 1. Service Catalog Management
- **Auto-sync from Morethanpanel**: All services are fetched and stored in SQLite database
- **50% markup applied**: Prices automatically calculated with your markup
- **Platform detection**: Instagram, TikTok, YouTube, Facebook, Twitter/X, Telegram, Spotify, etc.
- **Weekly auto-refresh**: Catalog updates automatically every 7 days
- **Manual sync**: Admin can trigger sync anytime via `/api/admin/sync-services`

### 2. Order Management
- **Create orders**: Place orders directly with Morethanpanel
- **Order tracking**: Real-time status updates (Pending, Processing, In Progress, Completed, etc.)
- **Order history**: Complete tracking with status history for each order
- **Progress tracking**: Shows start count, remains, and percentage complete

### 3. Advanced Features
- **Order refills**: Request refills for eligible orders
- **Order cancellation**: Cancel orders that are still in progress
- **Balance checking**: Monitor your Morethanpanel account balance
- **Customer dashboard**: Customers can track their orders via email
- **Admin dashboard**: View all services, sync catalog, check balance

## 📁 New Files Created

### Backend Modules
1. **`server/morethanpanel-client.js`** - Complete Morethanpanel API client
   - `getServices()` - Fetch all services
   - `createOrder()` - Place new order
   - `getOrderStatus()` - Check single order status
   - `getMultipleOrderStatus()` - Check multiple orders
   - `getBalance()` - Check account balance
   - `refillOrder()` - Request order refill
   - `getRefillStatus()` - Check refill status
   - `cancelOrder()` - Cancel an order
   - `createSubscription()` - Create subscription orders

2. **`server/order-store.js`** - Order database management
   - SQLite-based order storage
   - Order status history tracking
   - Customer order retrieval
   - Refill and cancellation tracking

3. **`server/index.js`** (Updated) - Main server with all API endpoints

### Frontend Files
1. **`js/api-client.js`** - Frontend API client for all operations
2. **`customer-dashboard/orders.html`** - Customer order tracking dashboard
3. **`admin/services.html`** - Admin services management dashboard
4. **`checkout.html`** (Updated) - Now creates real orders

## 🔌 API Endpoints

### Public Endpoints

#### Get Service Catalog
```
GET /api/storefront/catalog
```
Returns all available services with 50% markup applied.

#### Create Order
```
POST /api/storefront/orders
Content-Type: application/json

{
  "serviceId": "xd-abc123...",
  "link": "https://instagram.com/username",
  "quantity": 1000,
  "customerEmail": "customer@example.com"
}
```

#### Get Order Status
```
GET /api/storefront/orders/:orderId
```

#### Get Customer Orders
```
GET /api/storefront/orders?email=customer@example.com
```

#### Get Order History
```
GET /api/storefront/orders/:orderId/history
```

#### Request Refill
```
POST /api/storefront/orders/:orderId/refill
```

#### Cancel Order
```
POST /api/storefront/orders/:orderId/cancel
```

### Admin Endpoints

#### Check Balance
```
GET /api/admin/balance
```

#### Sync Services
```
POST /api/admin/sync-services
```
Manually trigger service catalog refresh from Morethanpanel.

## 🗄️ Database Schema

### Orders Table
- `id` - Unique order ID (xd-order-...)
- `provider_order_id` - Morethanpanel order ID
- `customer_email` - Customer email
- `service_id` - Service public ID
- `service_title` - Service name
- `platform` - Platform (Instagram, TikTok, etc.)
- `link` - Target URL/username
- `quantity` - Order quantity
- `charge` - Amount charged to customer
- `start_count` - Starting count from provider
- `remains` - Remaining quantity
- `status` - Order status
- `created_at` - Order creation time
- `updated_at` - Last update time
- `refillable` - Whether refill is available
- `refill_id` - Refill request ID
- `refill_status` - Refill status
- `cancel_requested` - Cancellation flag

### Order Status History Table
- Tracks all status changes for each order
- Includes timestamp, status, remains, and start count

### Catalog Services Table
- Stores all Morethanpanel services
- Maps provider service IDs to public IDs
- Includes pricing with markup applied

## 🚀 How to Use

### For Customers

1. **Browse Services**: Visit http://localhost:3187/services.html
2. **Select Service**: Click "Order Now" on any service
3. **Checkout**: Fill in link/username, quantity, and email
4. **Track Orders**: Visit http://localhost:3187/customer-dashboard/orders.html
5. **Enter Email**: Your orders will appear automatically
6. **Refresh Status**: Click "Refresh Status" to update order progress
7. **Request Refill**: Available for completed refillable orders
8. **Cancel Order**: Cancel orders that haven't completed

### For Admins

1. **View Services**: Visit http://localhost:3187/admin/services.html
2. **Check Balance**: See your Morethanpanel balance in real-time
3. **Sync Services**: Click "Sync Services" to update catalog
4. **Search/Filter**: Find specific services by platform, keyword, or refillable status
5. **Sort Services**: Click column headers to sort

## ⚙️ Configuration

### Environment Variables (.env)
```
PORT=3187
MORETHANPANEL_API_KEY=8b5a2acf7c7256e5954ee1e4efbcb468
XDRIVE_MARKUP_PERCENT=50
XDRIVE_DATABASE_PATH=./data/xdrive.sqlite
```

### Markup Configuration
- Current markup: **50%**
- Example: If provider charges $1.00 per 1K, you charge $1.50 per 1K
- Change `XDRIVE_MARKUP_PERCENT` to adjust markup

## 🔄 Automatic Updates

### Catalog Refresh
- Runs automatically every 7 days
- Updates prices, min/max quantities, and new services
- No downtime during refresh

### Order Status Sync
- Updates when customer views order
- Real-time status from Morethanpanel
- Status history preserved

## 📊 Supported Platforms

The integration automatically detects and categorizes services for:
- Instagram
- TikTok
- YouTube
- Facebook
- Twitter/X
- Telegram
- Spotify
- SoundCloud
- Snapchat
- Discord
- Twitch
- Kick
- LinkedIn

## 🔒 Security Features

- API key stored in environment variables
- Provider order IDs kept separate from public IDs
- Input validation on all endpoints
- SQL injection protection via parameterized queries
- Email validation for customer orders

## 📈 Current Status

✅ **3,285 services loaded** from Morethanpanel
✅ **50% markup applied** to all services
✅ **All API features integrated**:
   - Service catalog ✓
   - Order creation ✓
   - Order tracking ✓
   - Order refills ✓
   - Order cancellation ✓
   - Balance checking ✓
   - Live status updates ✓
   - Order history ✓

## 🎯 Testing

### Test Order Flow
1. Start server: `npm start`
2. Open http://localhost:3187
3. Click "Browse Services"
4. Select any service
5. Fill checkout form
6. Order will be created with Morethanpanel
7. Track order at customer-dashboard/orders.html

### Test Admin Features
1. Visit http://localhost:3187/admin/services.html
2. View balance (refreshes every minute)
3. Search/filter services
4. Click "Sync Services" to refresh catalog

## 🛠️ Troubleshooting

### Server won't start
- Check `.env` file exists
- Verify `MORETHANPANEL_API_KEY` is set
- Ensure `XDRIVE_MARKUP_PERCENT` is a number (not "50%")

### No services loading
- Check Morethanpanel API key is valid
- Verify internet connection
- Check server console for error messages

### Orders not creating
- Verify service ID is valid
- Check quantity is within min/max range
- Ensure link/username format is correct
- Verify email is valid format

## 📞 Support

For issues with:
- **API integration**: Check server console logs
- **Morethanpanel API**: Contact Morethanpanel support
- **Order issues**: Check customer dashboard for status

## 🔮 Future Enhancements

Potential additions:
- Payment gateway integration (Paystack)
- Email notifications for order updates
- Bulk order management
- Advanced analytics dashboard
- Customer accounts with login
- Reseller management system

---

**Integration completed successfully!** 🎉
All Morethanpanel features are now live and operational.
