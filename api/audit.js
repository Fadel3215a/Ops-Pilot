// api/audit.js
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { email, revenue, bottleneck, software } = req.body;

    // Deterministic Logic (No AI cost/latency)
    let score = (revenue.includes('1M') ? 50 : 80);
    let savings = (revenue.includes('1M') ? 25000 : 50000);
    let hours = (bottleneck.includes('Manual') ? 40 : 20);

    const resultData = { score, savings, hours };

    try {
        // 1. Send Email via Resend
        await resend.emails.send({
            from: 'OpsPilot <strategy@opspilot.com>',
            to: email,
            subject: 'Your OpsPilot Operations Audit Results',
            html: `<h1>Audit Results</h1><p>Efficiency Score: ${score}/100</p><p>Est. Annual Savings: $${savings}</p><p>Hours Saved: ${hours}</p>`
        });

        // 2. Sync to CRM (Zapier/Make/HubSpot)
        await fetch(process.env.CRM_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, revenue, bottleneck, ...resultData })
        });

        return res.status(200).json(resultData);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to process audit' });
    }
}
