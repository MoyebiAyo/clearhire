from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
OUT.mkdir(parents=True, exist_ok=True)
PDF = OUT / "clearhire-hackathon-pitch.pdf"
HTML = ROOT / "output" / "clearhire-hackathon-pitch.html"

W, H = 13.333 * inch, 7.5 * inch
BG = colors.HexColor("#07111f")
PANEL = colors.HexColor("#0d1b2d")
PANEL_2 = colors.HexColor("#12243a")
INK = colors.HexColor("#f5f7fb")
MUTED = colors.HexColor("#a7b5c9")
INDIGO = colors.HexColor("#7c78ff")
MINT = colors.HexColor("#47d7a5")
CORAL = colors.HexColor("#ff8f7a")
LINE = colors.HexColor("#20344d")

FONT = "Helvetica"
BOLD = "Helvetica-Bold"


def fit_paragraph(c, text, x, y, width, size, leading=None, color=INK, align=TA_LEFT, bold=False):
    style = ParagraphStyle(
        "slide",
        fontName=BOLD if bold else FONT,
        fontSize=size,
        leading=leading or size * 1.25,
        textColor=color,
        alignment=align,
        spaceAfter=0,
    )
    p = Paragraph(text, style)
    _, height = p.wrap(width, H)
    p.drawOn(c, x, y - height)
    return height


def text(c, value, x, y, size=14, color=INK, bold=False, align=TA_LEFT):
    c.setFont(BOLD if bold else FONT, size)
    c.setFillColor(color)
    if align == TA_CENTER:
        c.drawCentredString(x, y, value)
    else:
        c.drawString(x, y, value)


def line(c, x1, y1, x2, y2, color=LINE, width=1):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x1, y1, x2, y2)


def rounded(c, x, y, w, h, fill=PANEL, stroke=None, radius=14):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1 if stroke else 0)


def dot(c, x, y, r, fill):
    c.setFillColor(fill)
    c.circle(x, y, r, fill=1, stroke=0)


def chrome(c, number, kicker):
    text(c, "CLEARHIRE", 0.58 * inch, H - 0.45 * inch, 9, MUTED, True)
    text(c, kicker.upper(), W - 0.58 * inch, H - 0.45 * inch, 9, MUTED, True, TA_CENTER)
    line(c, 0.58 * inch, 0.43 * inch, W - 0.58 * inch, 0.43 * inch)
    text(c, f"0{number}", W - 0.58 * inch, 0.2 * inch, 9, MUTED, True, TA_CENTER)


def title(c, eyebrow, heading, sub=None):
    text(c, eyebrow.upper(), 0.72 * inch, H - 1.12 * inch, 10, MINT, True)
    fit_paragraph(c, heading, 0.72 * inch, H - 1.42 * inch, 7.1 * inch, 30, 34, INK, bold=True)
    if sub:
        fit_paragraph(c, sub, 0.72 * inch, H - 2.38 * inch, 6.5 * inch, 13, 18, MUTED)


def bullet(c, x, y, heading, body, accent=INDIGO, width=5.3 * inch):
    dot(c, x, y - 4, 4, accent)
    text(c, heading, x + 14, y, 14, INK, True)
    fit_paragraph(c, body, x + 14, y - 20, width - 14, 11, 15, MUTED)


def draw_cover(c):
    c.setFillColor(BG); c.rect(0, 0, W, H, fill=1, stroke=0)
    for x, y, r, col in [(W * .78, H * .72, 190, colors.Color(.3, .25, 1, .12)), (W * .9, H * .22, 130, colors.Color(.1, .85, .6, .08))]:
        c.setFillColor(col); c.circle(x, y, r, fill=1, stroke=0)
    text(c, "CLEARHIRE", 0.72 * inch, H - 0.62 * inch, 11, MINT, True)
    text(c, "AI BUILD FEST 2026  /  TRACK 1", W - 0.72 * inch, H - 0.62 * inch, 10, MUTED, True, TA_CENTER)
    fit_paragraph(c, "Hiring should not\nbe a memory test.", 0.72 * inch, H - 1.45 * inch, 7.2 * inch, 40, 44, INK, bold=True)
    fit_paragraph(c, "ClearHire helps growing teams read every application fairly, explain the ranking, and close the loop with every candidate.", 0.76 * inch, H - 3.65 * inch, 5.5 * inch, 16, 22, MUTED)
    rounded(c, W - 4.75 * inch, 1.08 * inch, 3.55 * inch, 3.8 * inch, PANEL, LINE, 18)
    text(c, "THE CONTROL BOUNDARY", W - 4.35 * inch, 4.42 * inch, 10, MINT, True)
    text(c, "Score merit", W - 4.35 * inch, 3.72 * inch, 27, INK, True)
    text(c, "first.", W - 4.35 * inch, 3.27 * inch, 27, INDIGO, True)
    line(c, W - 4.35 * inch, 2.88 * inch, W - 1.42 * inch, 2.88 * inch, LINE, 2)
    text(c, "Reveal identity", W - 4.35 * inch, 2.48 * inch, 18, INK, True)
    text(c, "second.", W - 4.35 * inch, 2.15 * inch, 18, MINT, True)
    text(c, "Then let a human decide.", W - 4.35 * inch, 1.48 * inch, 11, MUTED)


def draw_problem(c):
    chrome(c, 2, "The cost of volume")
    title(c, "THE PROBLEM", "Recruiters do not have a screening problem. They have a consistency problem.", "When applications pile up, the process degrades in predictable ways.")
    cards = [
        ("300", "applications", "A realistic SME role can attract more candidates than one person can properly read.", CORAL),
        ("40", "CVs read", "Fatigue turns a structured decision into a first-impression contest.", INDIGO),
        ("0", "closure", "The people who are rejected often receive silence instead of a clear next step.", MINT),
    ]
    x = 0.72 * inch
    for number, label, body, accent in cards:
        rounded(c, x, 1.25 * inch, 3.62 * inch, 2.25 * inch, PANEL, LINE)
        text(c, number, x + 0.32 * inch, 2.75 * inch, 38, accent, True)
        text(c, label, x + 0.32 * inch, 2.27 * inch, 12, INK, True)
        fit_paragraph(c, body, x + 0.32 * inch, 1.94 * inch, 2.95 * inch, 11, 15, MUTED)
        x += 4.0 * inch
    fit_paragraph(c, "The damage compounds downstream: scheduling takes hours, no-shows become normal, and candidate experience becomes an afterthought.", 0.72 * inch, 0.92 * inch, 10.2 * inch, 14, 19, INK, bold=True)


def draw_insight(c):
    chrome(c, 3, "The product insight")
    title(c, "THE INSIGHT", "Do not automate the hiring decision. Automate the noise around it.", "ClearHire keeps judgment human while making the repeatable work structured, explainable, and fast.")
    line(c, 1.2 * inch, 2.9 * inch, 12.15 * inch, 2.9 * inch, LINE, 3)
    steps = [("01", "Blind", "Score only job-relevant evidence."), ("02", "Explain", "Show gaps against the rubric."), ("03", "Reveal", "Connect the score to a person only after."), ("04", "Follow through", "Schedule, remind, and close the loop.")]
    x = 1.0 * inch
    for n, head, body in steps:
        text(c, n, x, 3.35 * inch, 12, MINT, True)
        text(c, head, x, 2.53 * inch, 21, INK, True)
        fit_paragraph(c, body, x, 2.14 * inch, 2.3 * inch, 11, 15, MUTED)
        x += 3.0 * inch
    rounded(c, 0.72 * inch, 0.72 * inch, 11.9 * inch, 0.62 * inch, PANEL_2)
    text(c, "The score is a decision aid, not a decision-maker.", W / 2, 0.95 * inch, 14, INK, True, TA_CENTER)


def draw_workflow(c):
    chrome(c, 4, "One operating system")
    title(c, "THE WORKFLOW", "From inbox to interview, without losing the human thread.", "A single candidate record carries the process from raw CV to final conversation.")
    stages = [
        ("IN", "Upload or Gmail", "PDF / DOCX\nprivate storage"),
        ("READ", "Extract", "structured\nprofile"),
        ("RANK", "Score blind", "weighted rubric\n+ gap analysis"),
        ("MOVE", "Schedule", "timezone + ICS\n4 reminders"),
        ("CLOSE", "Decide", "scorecard\nrespectful close"),
    ]
    x = 0.72 * inch
    for i, (tag, head, body) in enumerate(stages):
        rounded(c, x, 1.42 * inch, 2.15 * inch, 2.2 * inch, PANEL, LINE)
        text(c, tag, x + 0.22 * inch, 3.27 * inch, 9, MINT, True)
        text(c, head, x + 0.22 * inch, 2.72 * inch, 17, INK, True)
        fit_paragraph(c, body.replace("\n", "<br/>"), x + 0.22 * inch, 2.25 * inch, 1.65 * inch, 11, 16, MUTED)
        if i < len(stages) - 1:
            text(c, ">", x + 2.29 * inch, 2.34 * inch, 24, INDIGO, True, TA_CENTER)
        x += 2.42 * inch
    fit_paragraph(c, "One job. One rubric. One explainable shortlist. One place to keep the promise to candidates.", 0.72 * inch, 0.92 * inch, 11 * inch, 14, 19, INK, bold=True)


def draw_blind(c):
    chrome(c, 5, "The defensible difference")
    title(c, "BLIND BY CONSTRUCTION", "The model never receives the identity fields.", "This is not a blurred table. The blind boundary is enforced where the scoring payload is built.")
    rounded(c, 0.72 * inch, 1.08 * inch, 5.4 * inch, 3.85 * inch, PANEL, LINE)
    text(c, "SENT TO THE MODEL", 1.05 * inch, 4.55 * inch, 10, MINT, True)
    for i, val in enumerate(["skills", "experience_years", "certifications", "tools"]):
        rounded(c, 1.05 * inch, (3.75 - i * .62) * inch, 3.3 * inch, 0.38 * inch, PANEL_2)
        text(c, val, 1.27 * inch, (3.87 - i * .62) * inch, 12, INK)
    rounded(c, 6.82 * inch, 1.08 * inch, 5.8 * inch, 3.85 * inch, colors.HexColor("#241b2a"), colors.HexColor("#63324c"))
    text(c, "NEVER SENT", 7.15 * inch, 4.55 * inch, 10, CORAL, True)
    for i, val in enumerate(["name", "email", "school", "photo / identity"]):
        text(c, "x", 7.2 * inch, (3.82 - i * .62) * inch, 15, CORAL, True)
        text(c, val, 7.55 * inch, (3.87 - i * .62) * inch, 12, INK)
    text(c, "Server-side boundary", 6.82 * inch, 0.88 * inch, 11, MINT, True)
    text(c, "Audit-logged payload", 10.0 * inch, 0.88 * inch, 11, MUTED, True)


def draw_demo(c):
    chrome(c, 6, "The money moment")
    title(c, "THE DEMO", "The reveal is the moment judges remember.", "Show the score before the name. Then prove the rest of the workflow is already connected.")
    rounded(c, 0.72 * inch, 1.0 * inch, 7.0 * inch, 4.35 * inch, PANEL, LINE)
    text(c, "RANKED SHORTLIST", 1.05 * inch, 4.93 * inch, 10, MINT, True)
    rows = [("#1", "Candidate #1", "91", MINT), ("#2", "Candidate #2", "88", INDIGO), ("#3", "Candidate #3", "83", CORAL)]
    y = 3.95 * inch
    for rank, cand, score, accent in rows:
        line(c, 1.05 * inch, y - .28 * inch, 7.35 * inch, y - .28 * inch)
        dot(c, 1.22 * inch, y, 12, colors.Color(accent.red, accent.green, accent.blue, .18))
        text(c, rank, 1.22 * inch, y - 4, 9, accent, True, TA_CENTER)
        text(c, cand, 1.65 * inch, y + 6, 14, INK, True)
        text(c, "blind score · gaps · rationale", 1.65 * inch, y - 12, 10, MUTED)
        text(c, score, 6.75 * inch, y - 2, 23, INK, True, TA_CENTER)
        y -= .9 * inch
    rounded(c, 8.25 * inch, 1.0 * inch, 4.38 * inch, 4.35 * inch, PANEL_2)
    text(c, "REVEAL", 8.6 * inch, 4.93 * inch, 10, MINT, True)
    fit_paragraph(c, "The score was locked before anyone connected it to a person.", 8.6 * inch, 4.45 * inch, 3.55 * inch, 20, 25, INK, bold=True)
    line(c, 8.6 * inch, 2.98 * inch, 12.25 * inch, 2.98 * inch, LINE, 2)
    text(c, "Then:", 8.6 * inch, 2.58 * inch, 11, MUTED, True)
    fit_paragraph(c, "schedule the interview · confirm timezone · arm reminders · compare human scorecard · close respectfully", 8.6 * inch, 2.28 * inch, 3.4 * inch, 13, 19, INK)


def draw_proof(c):
    chrome(c, 7, "Proof, not promises")
    title(c, "EVIDENCE", "We built the trust story into the system.", "The winning claim is not that AI is perfect. It is that the workflow is inspectable, bounded, and human-controlled.")
    proofs = [
        ("RLS", "Cross-tenant isolation", "Tenant B could not read, update, or delete Tenant A's job data."),
        ("4x", "Reminder cadence", "2 days, 1 day, 12 hours, 2 hours, created from the confirmed interview."),
        ("JSON", "Blind audit", "Every scoring call records a payload containing only four job-relevant fields."),
        ("5 min", "CV access", "Private CV bucket with short-lived signed download links."),
    ]
    x = 0.72 * inch
    for label, head, body in proofs:
        rounded(c, x, 1.35 * inch, 2.82 * inch, 2.75 * inch, PANEL, LINE)
        text(c, label, x + .3 * inch, 3.45 * inch, 28, MINT, True)
        text(c, head, x + .3 * inch, 2.8 * inch, 13, INK, True)
        fit_paragraph(c, body, x + .3 * inch, 2.4 * inch, 2.15 * inch, 10.5, 15, MUTED)
        x += 3.08 * inch
    fit_paragraph(c, "The human remains accountable. ClearHire makes the evidence easier to see and the process harder to forget.", 0.72 * inch, 0.9 * inch, 11.5 * inch, 15, 20, INK, bold=True)


def draw_market(c):
    chrome(c, 8, "Why this can win")
    title(c, "POSITIONING", "Not another ATS. A fairness-and-follow-through layer for teams that have outgrown spreadsheets.", "ClearHire is deliberately narrow: make screening more consistent, then carry the candidate through the moments that usually break.")
    rounded(c, 0.72 * inch, 1.05 * inch, 5.65 * inch, 3.85 * inch, PANEL, LINE)
    text(c, "BROAD ATS", 1.08 * inch, 4.48 * inch, 10, MUTED, True)
    fit_paragraph(c, "Many modules.\nHeavy implementation.\nAI as a feature.", 1.08 * inch, 3.95 * inch, 4.3 * inch, 22, 28, INK, bold=True)
    rounded(c, 6.95 * inch, 1.05 * inch, 5.65 * inch, 3.85 * inch, PANEL_2, INDIGO)
    text(c, "CLEARHIRE", 7.3 * inch, 4.48 * inch, 10, MINT, True)
    fit_paragraph(c, "Inbox-native intake.\nBlind-score-then-reveal.\nReminders tuned for no-shows.\nHuman decision stays visible.", 7.3 * inch, 3.95 * inch, 4.5 * inch, 21, 28, INK, bold=True)
    text(c, "Start with one painful role. Earn the right to become the hiring system.", W / 2, 0.82 * inch, 14, INK, True, TA_CENTER)


def draw_roadmap(c):
    chrome(c, 9, "The business")
    title(c, "A CREDIBLE START", "Win the first hiring workflow. Expand from there.", "The initial customer is an SME recruiter who needs speed and consistency, not another six-month implementation.")
    items = [("NOW", "SME recruiting teams", "CV intake, blind ranking, scheduling, closure"), ("NEXT", "Agencies and hiring teams", "shared templates, analytics, candidate exams"), ("LATER", "Hiring infrastructure", "audit trails, integrations, team workflows")]
    y = 3.7 * inch
    for i, (tag, head, body) in enumerate(items):
        dot(c, 1.02 * inch, y + .05 * inch, 8, [MINT, INDIGO, CORAL][i])
        text(c, tag, 1.38 * inch, y, 10, [MINT, INDIGO, CORAL][i], True)
        text(c, head, 2.45 * inch, y, 16, INK, True)
        text(c, body, 2.45 * inch, y - .3 * inch, 12, MUTED)
        if i < 2: line(c, 1.02 * inch, y - .5 * inch, 1.02 * inch, y - 1.15 * inch, LINE, 2)
        y -= 1.12 * inch
    rounded(c, 7.9 * inch, 1.25 * inch, 4.6 * inch, 2.65 * inch, PANEL, LINE)
    text(c, "THE NORTH STAR", 8.25 * inch, 3.48 * inch, 10, MINT, True)
    fit_paragraph(c, "Every candidate gets a fair read, a clear next step, and a respectful close.", 8.25 * inch, 3.05 * inch, 3.65 * inch, 22, 28, INK, bold=True)


def draw_close(c):
    c.setFillColor(BG); c.rect(0, 0, W, H, fill=1, stroke=0)
    text(c, "CLEARHIRE", 0.72 * inch, H - 0.62 * inch, 11, MINT, True)
    fit_paragraph(c, "The best candidate\nshould not be the\nfirst CV opened.", 0.72 * inch, H - 1.4 * inch, 7.2 * inch, 37, 42, INK, bold=True)
    fit_paragraph(c, "Score merit first. Reveal identity second. Keep the human in the loop.", 0.76 * inch, 2.23 * inch, 6.4 * inch, 18, 24, MUTED)
    rounded(c, W - 4.65 * inch, 1.35 * inch, 3.55 * inch, 3.75 * inch, PANEL, LINE, 18)
    text(c, "LIVE DEMO", W - 4.2 * inch, 4.55 * inch, 10, MINT, True)
    text(c, "clearhire-rho", W - 4.2 * inch, 3.78 * inch, 24, INK, True)
    text(c, ".vercel.app", W - 4.2 * inch, 3.4 * inch, 15, INDIGO, True)
    line(c, W - 4.2 * inch, 2.92 * inch, W - 1.4 * inch, 2.92 * inch, LINE, 2)
    text(c, "AI BuildFest 2026", W - 4.2 * inch, 2.45 * inch, 12, MUTED, True)
    text(c, "Track 1 · AI for Business", W - 4.2 * inch, 2.1 * inch, 11, MUTED)
    text(c, "Thank you", W / 2, 0.55 * inch, 11, MUTED, True, TA_CENTER)


def build_pdf():
    c = canvas.Canvas(str(PDF), pagesize=(W, H))
    pages = [draw_cover, draw_problem, draw_insight, draw_workflow, draw_blind, draw_demo, draw_proof, draw_market, draw_roadmap, draw_close]
    for draw in pages:
        draw(c)
        c.showPage()
    c.save()


def build_html():
    html = """<!doctype html><meta charset='utf-8'><title>ClearHire Pitch</title>
<style>body{margin:0;background:#07111f;color:#f5f7fb;font-family:system-ui,sans-serif}.slide{width:min(1280px,100vw);aspect-ratio:16/9;margin:24px auto;padding:6vw;box-sizing:border-box;background:#07111f;position:relative;overflow:hidden}.k{color:#47d7a5;font-size:12px;font-weight:700;letter-spacing:.12em}.slide h1{font-size:clamp(34px,4vw,68px);line-height:1.02;max-width:820px;margin:28px 0 18px}.slide p{color:#a7b5c9;font-size:20px;line-height:1.4;max-width:760px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:48px}.card{background:#0d1b2d;border:1px solid #20344d;border-radius:16px;padding:28px}.card b{font-size:38px;color:#47d7a5}.card h2{font-size:20px}.card p{font-size:15px}.foot{position:absolute;bottom:24px;right:6vw;color:#64748b;font-size:12px}@media(max-width:600px){.slide{margin:8px auto;padding:8vw}.grid{grid-template-columns:1fr}.slide p{font-size:16px}}</style>
<section class='slide'><div class='k'>CLEARHIRE / AI BUILDFEST 2026</div><h1>Hiring should not<br>be a memory test.</h1><p>Read every application fairly. Explain the ranking. Close the loop with every candidate.</p><div class='card' style='position:absolute;right:8%;bottom:18%;width:260px'><div class='k'>THE CONTROL BOUNDARY</div><h2>Score merit <span style='color:#7c78ff'>first.</span></h2><h2>Reveal identity <span style='color:#47d7a5'>second.</span></h2><p>Then let a human decide.</p></div></section>
<section class='slide'><div class='k'>THE PROBLEM</div><h1>Recruiters do not have a screening problem. They have a consistency problem.</h1><p>Volume turns structured decisions into first-impression contests. Scheduling and closure break downstream.</p><div class='grid'><div class='card'><b>300</b><h2>applications</h2><p>More candidates than one person can properly read.</p></div><div class='card'><b>40</b><h2>CVs read</h2><p>Fatigue changes the quality of the decision.</p></div><div class='card'><b>0</b><h2>closure</h2><p>Rejected candidates often receive silence.</p></div></div></section>
<section class='slide'><div class='k'>THE INSIGHT</div><h1>Do not automate the hiring decision. Automate the noise around it.</h1><p>Blind first. Explain the evidence. Reveal later. Then schedule, remind, and close.</p><div class='grid'><div class='card'><b>01</b><h2>Blind</h2><p>Only job-relevant evidence enters scoring.</p></div><div class='card'><b>02</b><h2>Explain</h2><p>Gaps map back to the recruiter’s rubric.</p></div><div class='card'><b>03</b><h2>Follow through</h2><p>Scheduling, reminders, scorecards, and respectful rejection.</p></div></div></section>
<section class='slide'><div class='k'>THE DIFFERENCE</div><h1>The model never receives the identity fields.</h1><p>Server-side payload construction makes the blind boundary inspectable, not decorative.</p><div class='grid'><div class='card'><b>IN</b><h2>skills</h2><p>experience_years<br>certifications<br>tools</p></div><div class='card' style='border-color:#7c78ff'><b style='color:#7c78ff'>OUT</b><h2>identity</h2><p>name<br>email<br>school<br>photo</p></div><div class='card'><b>LOG</b><h2>audit trail</h2><p>Scoring calls are audit-logged with the four-field blind payload.</p></div></div></section>
<section class='slide'><div class='k'>THE DEMO</div><h1>The reveal is the moment judges remember.</h1><p>Show the score before the name. Then prove the rest of the workflow is already connected.</p><div class='card' style='margin-top:48px'><h2>#1 &nbsp; Candidate #1 <span style='float:right;color:#47d7a5'>91</span></h2><p>blind score · gaps · rationale</p><hr><h2>#2 &nbsp; Candidate #2 <span style='float:right;color:#7c78ff'>88</span></h2><p>Reveal only after the score is locked.</p></div></section>
<section class='slide'><div class='k'>EVIDENCE</div><h1>We built the trust story into the system.</h1><div class='grid'><div class='card'><b>RLS</b><h2>Tenant isolation</h2><p>Cross-tenant reads and updates were tested and blocked.</p></div><div class='card'><b>4x</b><h2>Reminders</h2><p>2d, 1d, 12h, and 2h cadence.</p></div><div class='card'><b>5m</b><h2>CV access</h2><p>Private bucket and short-lived signed links.</p></div></div></section>
<section class='slide'><div class='k'>POSITIONING</div><h1>Not another ATS. A fairness-and-follow-through layer.</h1><p>For teams that have outgrown spreadsheets, but do not need a six-month enterprise implementation.</p><div class='grid'><div class='card'><h2>Inbox-native</h2><p>CVs can arrive where recruiters already work.</p></div><div class='card'><h2>Blind-score-then-reveal</h2><p>Rubric-visible and human-controlled.</p></div><div class='card'><h2>Candidate-aware</h2><p>Scheduling and closure are part of the product.</p></div></div></section>
<section class='slide'><div class='k'>THE ASK</div><h1>Give every candidate a fair read, a clear next step, and a respectful close.</h1><p>ClearHire makes the evidence easier to see and the process harder to forget.</p><div class='card' style='margin-top:48px;width:340px'><div class='k'>LIVE DEMO</div><h2>clearhire-rho.vercel.app</h2><p>AI BuildFest 2026<br>Track 1 · AI for Business</p></div></section>"""
    HTML.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    build_pdf()
    build_html()
    print(PDF)
    print(HTML)
