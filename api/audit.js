import { Resend } from 'resend';

// Only initialize Resend if the key is present
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { revenue, employees, tickets, bottleneck, software, email, name } = req.body;

  if (!email || !name) {
    return res.status(400).json({ message: 'Email and Name are required' });
  }

  try {
    // 1. DETERMINISTIC AUDIT LOGIC
    let score = 50;
    let savings = 15000;
    let hours = 20;

    if (revenue === '$5M - $10M') { savings = 45000; score -= 5; hours += 30; }
    else if (revenue === '$3M - $5M') { savings = 30000; score -= 5; hours += 20; }
    
    if (tickets === '2,000+') { score -= 15; hours += 40; }
    else if (tickets === '500 - 2,000') { score -= 5; hours += 15; }

    const result = { 
        efficiencyScore: score, 
        estSavings: `$${savings.toLocaleString()}`, 
        estHoursSaved: hours,
        bottleneckDetail: bottleneck || "General operational drag"
    };

    // 2. CRM SYNC (Only if configured)
    if (process.env.CRM_WEBHOOK_URL) {
        await fetch(process.env.CRM_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...req.body, ...result })
        }).catch(err => console.error("CRM Sync Error", err));
    }

    // 3. EMAIL DELIVERY (Only if configured)
    if (resend) {
        const calLink = process.env.NEXT_PUBLIC_CALENDLY_URL || 'mailto:sales@opspilot.com';
        await resend.emails.send({
            from: 'OpsPilot Audit <audit@opspilot.com>',
            to: email,
            subject: 'Your OpsPilot Efficiency Report',
            html: `<h1>Hi ${name},</h1><p>Your efficiency score is ${result.efficiencyScore}/100.</p><p>You could save <strong>${result.estHoursSaved} hours</strong> per month.</p><a href="${calLink}">Book Your Strategy Call</a>`
        }).catch(err => console.error("Email Error", err));
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Backend Error:", error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}