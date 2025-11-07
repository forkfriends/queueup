# Cost Monitoring Checklist

Check these metrics weekly in Cloudflare dashboard to avoid overages:

## Critical Metrics (Check Weekly)

### 1. Durable Objects Duration (HIGHEST RISK)
- **Location:** Cloudflare Dashboard → Workers → queueup-api → Metrics → Durable Objects
- **Metric:** "Duration" (GB-seconds)
- **Limit:** 400,000 GB-seconds/month included
- **Check:** Current usage / 400,000 × 100 = % of limit used

**Warning thresholds:**
- 🟢 <50% (200,000 GB-seconds) = Safe
- 🟡 50-80% (200k-320k) = Monitor closely
- 🔴 >80% (320k+) = High risk of overage

**Action if yellow/red:**
- Check average concurrent WebSocket connections
- Consider closing inactive queues automatically
- Look for "ghost" connections that never close

---

### 2. Durable Objects Requests
- **Location:** Same as above → "Requests"
- **Limit:** 1 million requests/month included
- **Check:** Current usage / 1,000,000 × 100 = % used

**Warning thresholds:**
- 🟢 <70% (700k requests) = Safe
- 🟡 70-90% (700k-900k) = Watch usage
- 🔴 >90% (900k+) = Approaching limit

**Action if yellow/red:**
- Count daily queues created
- Check for API abuse or bot traffic

---

### 3. D1 Database Writes
- **Location:** Cloudflare Dashboard → D1 → queueup-db → Metrics
- **Limit:** 50 million rows written/month included
- **Check:** Current usage / 50,000,000 × 100 = % used

**Warning thresholds:**
- 🟢 <80% (40M writes) = Safe
- 🟡 80-95% (40M-47.5M) = Monitor
- 🔴 >95% (47.5M+) = Very close to limit

**Unlikely to hit this unless:**
- Serving 100+ restaurants daily
- Bug causing write loops

---

## Quick Weekly Check (5 minutes)

```
Date: ___________

✓ Durable Objects Duration: _______ / 400,000 GB-sec (____%)
✓ Durable Objects Requests: _______ / 1,000,000 (____%)
✓ D1 Writes: _______ / 50,000,000 (____%)
✓ Workers Requests: _______ / 10,000,000 (____%)

Estimated Bill: $5 + overages = $_______

Notes:
_____________________________________________
_____________________________________________
```

---

## Cost Estimation Formulas

### Durable Objects Duration Overage
```
Overage GB-seconds = (Actual usage - 400,000)
Cost = Overage / 1,000,000 × $12.50
```

**Example:**
- Used 800,000 GB-seconds this month
- Overage = 800,000 - 400,000 = 400,000
- Cost = 400,000 / 1,000,000 × $12.50 = **$5.00 overage**
- **Total bill = $5 + $5 = $10.00**

### Durable Objects Requests Overage
```
Overage requests = (Actual usage - 1,000,000)
Cost = Overage / 1,000,000 × $0.15
```

### D1 Writes Overage
```
Overage writes = (Actual usage - 50,000,000)
Cost = Overage / 1,000,000 × $1.00
```

---

## Red Flags 🚩

Watch for these warning signs:

1. **Duration spiking without more users**
   - Possible memory leak
   - WebSockets not closing properly
   - Check for "ghost" Durable Objects

2. **Requests way higher than expected**
   - Bot traffic
   - API being called in a loop (frontend bug)
   - DDoS attempt

3. **Sudden cost jump**
   - Check metrics immediately
   - Look at event logs for anomalies
   - Pause worker if necessary (emergency)

---

## Emergency Cost Control

If costs are spiraling:

1. **Immediate actions:**
   ```bash
   # View real-time logs
   npx wrangler tail --config api/wrangler.toml

   # Check if worker is under attack
   # Look for repeated requests from same IP
   ```

2. **Temporary fixes:**
   - Add rate limiting (Cloudflare Workers rate limit)
   - Increase auto-close timeout for inactive queues
   - Disable push notifications temporarily

3. **Nuclear option:**
   - Pause worker deployment in Cloudflare dashboard
   - Investigate offline
   - Redeploy with fixes

---

## Optimization Tips

### Reduce Duration (WebSocket) Costs:
- ✅ Close queues automatically after X hours of inactivity
- ✅ Ping/pong WebSockets to detect dead connections
- ✅ Set max queue lifetime (e.g., 12 hours)

### Reduce Request Costs:
- ✅ Batch operations where possible
- ✅ Cache VAPID public key (already doing this)
- ✅ Rate limit API endpoints

### Reduce D1 Write Costs:
- ✅ Batch event logging (already optimized with push batching)
- ✅ Clean up old event data periodically

---

## Target Costs by Usage

**Low usage (1-5 restaurants/day):**
- Expected: $5-7/month
- If >$10: investigate

**Medium usage (10-20 restaurants/day):**
- Expected: $8-15/month
- If >$20: investigate

**High usage (50+ restaurants/day):**
- Expected: $20-40/month
- If >$60: investigate or consider dedicated server

---

## Monthly Review Checklist

At end of each month:

- [ ] Review actual bill vs estimate
- [ ] Check cost trends (increasing/stable/decreasing)
- [ ] Identify any anomalies
- [ ] Adjust forecasts for next month
- [ ] Update monitoring thresholds if needed

---

**Remember:** The paid plan is **$5/month base cost + usage overages**. You won't be charged unless you exceed the included limits!
