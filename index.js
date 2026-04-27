require('dotenv').config();
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Configuration
const RESUME_PATH = path.join(__dirname, 'Jatin_Sharma_SDE_FS.pdf');
const DAILY_LIMIT = 25; // 20-30 emails per day
const DELAY_BETWEEN_EMAILS_MS = 5000; // 5 seconds between emails 

const NOTION_TOKEN = process.env.NOTION_TOKEN
    ? process.env.NOTION_TOKEN.replace(/['"]/g, '').trim()
    : '';

let NOTION_DB_ID = process.env.NOTION_DB_ID
    ? process.env.NOTION_DB_ID.replace(/['"]/g, '').trim()
    : '';
if (!NOTION_DB_ID) {
    try {
        NOTION_DB_ID = fs.readFileSync(path.join(__dirname, 'db_id.txt'), 'utf8').trim();
    } catch (e) {
        NOTION_DB_ID = '';
    }
}

if (!NOTION_TOKEN) {
    console.error('❌ NOTION_TOKEN missing. Add it to .env in the project root (see .env.example).');
    process.exit(1);
}
if (!NOTION_DB_ID) {
    console.error('❌ Notion database id missing. Set NOTION_DB_ID in .env or create db_id.txt with your outreach database id.');
    process.exit(1);
}

// Helper functions for Notion API
const delay = ms => new Promise(res => setTimeout(res, ms));

async function rawNotionRequest(apiPath, method, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`https://api.notion.com/v1${apiPath}`, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Notion API Error: ${data.message}`);
  }
  return data;
}

async function main() {
    console.log('=============================================');
    console.log('🚀 Starting Cold Email Outreach System (Notion Edition)...');
    console.log('=============================================\n');

    // 1. Verify files exist
    if (!fs.existsSync(RESUME_PATH)) {
        console.error(`❌ Resume file not found at ${RESUME_PATH}`);
        process.exit(1);
    }

    // 2. Setup Email Transporter
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_PASS.includes('your_16_character')) {
        console.error(`❌ Missing or invalid EMAIL_USER or EMAIL_PASS in .env file.`);
        console.log('Please open the .env file and add your actual 16-character App Password.');
        process.exit(1);
    }

    console.log('🔑 Authenticating with Gmail...');
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    try {
        await transporter.verify();
        console.log('✅ Connected to Gmail SMTP server successfully.\n');
    } catch (error) {
        console.error('❌ Failed to connect to email server:', error.message);
        console.log('Make sure you are using an "App Password" (not your normal password) without any spaces.');
        process.exit(1);
    }

    // 3. Query Notion Database for Pending Targets
    console.log('📄 Querying Notion database for pending emails...');
    let pendingRecords = [];
    try {
        const queryResponse = await rawNotionRequest(`/databases/${NOTION_DB_ID}/query`, 'POST', {
            filter: {
                property: "Status",
                select: {
                    equals: "Pending"
                }
            },
            page_size: DAILY_LIMIT
        });
        pendingRecords = queryResponse.results;
    } catch (e) {
        console.error("❌ Failed to query Notion DB:", e.message);
        process.exit(1);
    }

    if (!pendingRecords || pendingRecords.length === 0) {
        console.log('🎉 No pending emails to send! Everyone in the list has already been contacted.');
        process.exit(0);
    }

    console.log(`🎯 Found ${pendingRecords.length} targets for today's batch.\n`);

    // 4. Send Emails
    let sentCount = 0;
    
    for (let i = 0; i < pendingRecords.length; i++) {
        const page = pendingRecords[i];
        const pageId = page.id;
        const props = page.properties;
        
        // Extract values safely from Notion properties
        let companyName = "your company";
        if (props['Company Name'] && props['Company Name'].title && props['Company Name'].title.length > 0) {
            companyName = props['Company Name'].title[0].plain_text;
        }

        let hrName = "Hiring Team";
        if (props['HR Name'] && props['HR Name'].rich_text && props['HR Name'].rich_text.length > 0) {
            hrName = props['HR Name'].rich_text[0].plain_text;
        }
        
        let targetEmail = "";
        if (props['Email'] && props['Email'].email) {
            targetEmail = props['Email'].email;
        }

        if (!targetEmail || !targetEmail.includes('@')) {
             console.log(`[${i+1}/${pendingRecords.length}] ⏭️ Skipping ${hrName} at ${companyName} (No valid email).`);
             // Mark as failed in Notion
             await rawNotionRequest(`/pages/${pageId}`, 'PATCH', {
                 properties: {
                     'Status': { select: { name: 'Failed' } },
                     'Remarks': { rich_text: [{ text: { content: 'Invalid or missing email address.' } }] }
                 }
             });
             continue;
        }

        console.log(`[${i+1}/${pendingRecords.length}] ⏳ Sending to ${hrName} at ${companyName} (${targetEmail})...`);

        const emailText = `Hi ${hrName},

I hope you're having a great week!

I'm reaching out because I've been following the work you're doing at ${companyName} and would love to bring my engineering experience to your team. 

I am a Full Stack Developer with 2+ years of production experience building scalable platforms, microservices, and AI-powered tools using Next.js, React, TypeScript, Node.js, and PostgreSQL. At my previous company, Persist Ventures, I developed complex features from the ground up, optimized core performance, and built automation workflows that directly impacted company efficiency.

I enjoy taking ownership of real-world problems and building intuitive, robust software. I would welcome the opportunity to discuss how my technical background aligns with any open Software Engineer or frontend/backend developer roles on your team.

I have attached my resume for your review. Thanks for your time and consideration—I look forward to hearing from you.

Best regards,

Jatin Sharma
Software Developer
📧 jkjatinsharma72@gmail.com | 📞 +91 6367807635
🔗 GitHub: https://github.com/MrtitaniumJ
🔗 LinkedIn: https://www.linkedin.com/in/jatin-sharma-82121217a/
🔗 Calendly: https://calendly.com/jkjatinsharma72/let-s-connect`;

        const mailOptions = {
            from: `"Jatin Sharma" <${process.env.EMAIL_USER}>`,
            to: targetEmail,
            subject: `Software Engineer (Next.js/React) exploring opportunities at ${companyName}`,
            text: emailText,
            attachments: [
                {
                    filename: 'Jatin_Sharma_SDE_FS.pdf',
                    path: RESUME_PATH
                }
            ]
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log(`      ✅ Successfully sent!`);
            
            // Re-save status to Notion Database (Performance Optimization: Run concurrently with delay)
            const updatePromise = rawNotionRequest(`/pages/${pageId}`, 'PATCH', {
                 properties: {
                     'Status': { select: { name: 'Sent' } },
                     'Remarks': { rich_text: [{ text: { content: `Sent on ${new Date().toISOString().split('T')[0]}` } }] }
                 }
             }).catch(err => {
                 console.error(`      ⚠️ Failed to update Notion status for sent email: ${err.message}`);
             });

            sentCount++;
            
            // Wait before sending the next one to avoid spam filters (except for the last one)
            if (i < pendingRecords.length - 1) {
                console.log(`      ⏱️  Waiting ${DELAY_BETWEEN_EMAILS_MS / 1000} seconds...`);
                await Promise.all([delay(DELAY_BETWEEN_EMAILS_MS), updatePromise]);
            } else {
                await updatePromise;
            }
        } catch (error) {
            console.error(`      ❌ Failed to send: ${error.message}`);
            // Save failure status
            await rawNotionRequest(`/pages/${pageId}`, 'PATCH', {
                 properties: {
                     'Status': { select: { name: 'Failed' } },
                     'Remarks': { rich_text: [{ text: { content: `Email Provider Error: ${error.message}` } }] }
                 }
             });
        }
    }

    console.log('\n=============================================');
    console.log(`🎉 Batch complete! Sent ${sentCount} emails today.`);
    console.log('=============================================');
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
});
