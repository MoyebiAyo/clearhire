"""Generate a demo JD + 20 matched test CVs into ~/Downloads/clearhire-test-cvs.

Deliberate score spread so every recruiter flow has something to do:
  - 6 strong   (React+Node+Postgres+AWS, certs, several with leadership evidence)
  - 5 good     (most core skills, 5-6 yrs)
  - 4 mid      (real gaps: single-stack or short experience)
  - 5 weak     (junior / missing core skills -> natural "reject below 60" set)
  - 03 uses the recruiter's own address (me@ayodev.tech) so exam invites and
    rejection emails can be received personally.

Usage:  python scripts/make-jd20-cvs.py
"""
from pathlib import Path

from docx import Document
from fpdf import FPDF

OUT = Path.home() / "Downloads" / "clearhire-test-cvs"

JD_TITLE = "Senior Full-Stack Engineer (React + Node.js)"

JD_TEXT = """About the role
We are hiring a Senior Full-Stack Engineer to own features end-to-end across our React front end and Node.js services. You will join a product team of eight and help us scale a B2B platform that processes thousands of transactions daily.

Responsibilities
- Build and ship production features in React 18 + TypeScript (hooks, context, performance profiling).
- Design and implement REST APIs in Node.js (Express or NestJS) with clean layering and validation.
- Model and optimize PostgreSQL schemas; write efficient queries and migrations.
- Containerize services with Docker and run them on AWS (ECS or Lambda) behind CI/CD pipelines (GitHub Actions).
- Write unit and end-to-end tests (Jest, React Testing Library, Playwright) and keep coverage meaningful.
- Review code, mentor mid-level engineers, and raise the bar on reliability and observability.

Must-have requirements
- 5+ years of professional software engineering experience.
- Strong, production React experience with TypeScript (state management, hooks, accessibility).
- Strong Node.js backend experience (Express or NestJS), including auth, validation and error handling.
- Solid PostgreSQL skills: schema design, indexing, query optimization, transactions.
- Hands-on AWS experience (at least one of ECS, Lambda, S3, RDS) and Docker in production.
- Experience with automated testing at both unit and end-to-end level; comfortable in CI/CD (GitHub Actions or similar).

Nice-to-have
- AWS certification (Solutions Architect or Developer).
- Kubernetes experience.
- Experience mentoring or leading small teams (tech lead or similar).
- Exposure to observability tooling (Grafana, Datadog, CloudWatch).

We value clear written communication, pragmatic trade-offs, and engineers who leave the codebase better than they found it."""

# (filename, format, name, email, body)
CVS = [
    ("01-chiamaka-eze-strong-lead", "pdf", "Chiamaka Eze", "chiamaka.eze.dev@gmail.com",
     """Chiamaka Eze
chiamaka.eze.dev@gmail.com | +234 803 555 0111 | Lagos, Nigeria

SUMMARY
Tech Lead and full-stack engineer with 8 years of experience building SaaS products with React, TypeScript and Node.js. Led a team of six engineers shipping a platform serving 30k daily active users.

SKILLS
React 18, TypeScript, Next.js, Node.js, NestJS, Express, PostgreSQL, REST API design, Docker, AWS (ECS, RDS, Lambda), CI/CD (GitHub Actions), Jest, React Testing Library, Playwright, mentoring, code review.

EXPERIENCE
Tech Lead, Paylane Systems (2021-present)
- Led a team of six engineers building a B2B invoicing platform (React + NestJS + PostgreSQL).
- Designed the multi-tenant schema and cut invoice-list query time from 2.1s to 80ms via indexing.
- Introduced Playwright e2e suites and GitHub Actions deploy pipelines; releases went weekly to daily.
Senior Full-Stack Engineer, Kudi Retail (2018-2021)
- Built the merchant dashboard in React/TypeScript; mentored four mid-level engineers.
- Migrated a legacy Express monolith to modular NestJS services on AWS ECS.

EDUCATION
BSc Computer Science, University of Lagos, 2015.

CERTIFICATIONS
AWS Certified Solutions Architect - Associate (2023).

TOOLS
Docker, AWS (ECS, RDS, S3, CloudWatch), GitHub Actions, Grafana, Figma (handoff)."""),
    ("02-tunde-bakare-staff", "pdf", "Tunde Bakare", "tunde.bakare.eng@gmail.com",
     """Tunde Bakare
tunde.bakare.eng@gmail.com | +234 802 555 0122 | Abuja, Nigeria

SUMMARY
Staff engineer, 9 years, mostly product full-stack: React/TypeScript on the front, Node.js and PostgreSQL on the back. Ran the engineering guild for platform reliability and acted as engineering manager for a quarter.

SKILLS
React, TypeScript, Redux Toolkit, Node.js, Express, PostgreSQL, Redis, REST and GraphQL, Docker, Kubernetes, AWS (EKS, Lambda, RDS), Terraform, GitHub Actions, Jest, Cypress, performance tuning, on-call leadership.

EXPERIENCE
Staff Engineer, Moni Finance (2020-present)
- Owned checkout reliability for a payments product (React + Express + PostgreSQL), 99.98% uptime.
- Ran the reliability guild: introduced SLOs, Grafana dashboards and blameless postmortems.
- Acting Engineering Manager for 5 months (hiring, reviews, roadmapping).
Senior Engineer, Swifta Systems (2016-2020)
- Built merchant analytics in React; designed PostgreSQL partitioning for 400M rows.

EDUCATION
BEng Computer Engineering, Ahmadu Bello University, 2014.

CERTIFICATIONS
Certified Kubernetes Administrator (2022); AWS Certified Developer - Associate (2021).

TOOLS
Docker, Kubernetes, Terraform, AWS, GitHub Actions, Datadog, Redis."""),
    ("03-ayo-segun-own-address", "pdf", "Ayodele Segun", "me@ayodev.tech",
     """Ayodele Segun
me@ayodev.tech | +234 809 555 0133 | Lagos, Nigeria

SUMMARY
Full-stack engineer with 6 years of experience shipping product features with React, TypeScript and Node.js. Owned the customer portal of a logistics platform end-to-end and mentored two junior engineers to promotion.

SKILLS
React, TypeScript, Node.js, Express, NestJS basics, PostgreSQL, Prisma, REST API design, Docker, AWS (ECS, S3, RDS, Lambda), GitHub Actions, Jest, React Testing Library, Playwright, mentoring.

EXPERIENCE
Senior Full-Stack Engineer, Trackmore Logistics (2022-present)
- Rebuilt the customer portal in React 18 + TypeScript; cut time-to-interactive by 45%.
- Built Node.js (Express) APIs for shipment tracking; PostgreSQL schema and index design.
- Set up GitHub Actions CI with Jest and Playwright gates; deploys to AWS ECS via Docker.
Full-Stack Engineer, Semsar Tech (2019-2022)
- Delivered 20+ features across React front end and Node services.
- Mentored two junior engineers through structured code review; both promoted.

EDUCATION
BSc Computer Science, University of Ilorin, 2018.

CERTIFICATIONS
AWS Certified Developer - Associate (2024).

TOOLS
Docker, AWS, GitHub Actions, Prisma, PostgreSQL, Vercel."""),
    ("04-fatima-yusuf-senior", "pdf", "Fatima Yusuf", "fatima.yusuf.dev@gmail.com",
     """Fatima Yusuf
fatima.yusuf.dev@gmail.com | +234 805 555 0144 | Kano, Nigeria

SUMMARY
Senior product engineer, 7 years. Strongest in React/TypeScript front ends and Node.js APIs on PostgreSQL. Ships fast without breaking tests; writes the docs nobody wants to write.

SKILLS
React, TypeScript, Next.js, Node.js, Express, PostgreSQL, REST, Docker, AWS (ECS, Lambda, S3), GitHub Actions, Jest, React Testing Library, Playwright, accessibility (WCAG 2.1).

EXPERIENCE
Senior Full-Stack Engineer, Lifebank Digital (2021-present)
- Led front-end architecture for a health data platform (React, TypeScript, 120+ components).
- Built Node/Express services on AWS Lambda; PostgreSQL with row-level security.
- Drove the accessibility program to WCAG 2.1 AA across the product.
Engineer, Codix Nigeria (2018-2021)
- Full-stack delivery for fintech dashboards (React, Node, PostgreSQL).

EDUCATION
BSc Information Technology, Bayero University Kano, 2016.

CERTIFICATIONS
AWS Certified Solutions Architect - Associate (2023).

TOOLS
Docker, AWS, GitHub Actions, Storybook, Lighthouse CI."""),
    ("05-ibrahim-sule-testing", "pdf", "Ibrahim Sule", "ibrahim.sule.dev@gmail.com",
     """Ibrahim Sule
ibrahim.sule.dev@gmail.com | +234 807 555 0155 | Kaduna, Nigeria

SUMMARY
Full-stack engineer, 6 years, quality-obsessed. Node.js and PostgreSQL backend specialist who is also productive in React. Believes a feature is not done until the tests and dashboards say so.

SKILLS
Node.js, Express, NestJS, PostgreSQL, React, TypeScript, Jest, Playwright, supertest, Docker, AWS (ECS, RDS), GitHub Actions, REST, JWT auth, load testing (k6).

EXPERIENCE
Senior Engineer, Eazipay (2021-present)
- Built settlement APIs in NestJS + PostgreSQL processing 120k transactions/day.
- Raised coverage from 31% to 84% with Jest and supertest; added Playwright smoke suites.
- Load-tested with k6 and fixed a connection-pool leak causing weekly outages.
Engineer, Paydock Africa (2018-2021)
- Node/Express microservices; React admin consoles.

EDUCATION
BSc Computer Science, Ahmadu Bello University, 2017.

CERTIFICATIONS
None yet - AWS Developer Associate scheduled.

TOOLS
Docker, AWS, GitHub Actions, k6, pgAdmin."""),
    ("06-adaeze-okafor-lead", "pdf", "Adaeze Okafor", "adaeze.okafor.dev@gmail.com",
     """Adaeze Okafor
adaeze.okafor.dev@gmail.com | +234 806 555 0166 | Enugu, Nigeria

SUMMARY
Engineering lead with 7 years across React front ends and Node.js platforms. Tech Lead for two product squads; comfortable owning roadmaps, reviews and production.

SKILLS
React, TypeScript, Node.js, NestJS, Express, PostgreSQL, Docker, AWS (ECS, Lambda), Kubernetes basics, GitHub Actions, Jest, Playwright, tech leadership, hiring and mentoring, stakeholder management.

EXPERIENCE
Tech Lead, Fint (2021-present)
- Lead two squads (8 engineers) building a lending platform (React + NestJS + PostgreSQL).
- Drove the migration to TypeScript across the front end; defect rate dropped 60%.
- Own architecture reviews and production readiness for all squad releases.
Senior Engineer, Andela partner teams (2018-2021)
- Full-stack delivery for US clients (React, Node, PostgreSQL, AWS).

EDUCATION
BSc Computer Science, University of Nigeria Nsukka, 2016.

CERTIFICATIONS
AWS Certified Developer - Associate (2022).

TOOLS
Docker, AWS, GitHub Actions, Jira, Figma."""),
    ("07-david-chen-good", "docx", "David Chen", "david.chen.dev@gmail.com",
     """David Chen
david.chen.dev@gmail.com | Berlin, Germany

SUMMARY
Product full-stack engineer, 5 years, React and Node.js. Enjoys owning a slice of the product from database migration to deployed UI.

SKILLS
React, TypeScript, Node.js, Express, PostgreSQL, REST, Docker, AWS (ECS, S3), GitHub Actions, Jest, React Testing Library.

EXPERIENCE
Full-Stack Engineer, Handelswerk (2021-present)
- Built customer onboarding flows in React/TypeScript; Node/Express APIs on AWS ECS.
- Wrote PostgreSQL migrations and backfills for a 2M-row customer table.
Front-End Engineer, Startupgarage (2019-2021)
- React SPAs; introduced Jest unit testing to the team.

EDUCATION
BSc Media Informatics, TU Berlin, 2018.

TOOLS
Docker, AWS, GitHub Actions, PostgreSQL."""),
    ("08-blessing-umeh-good", "pdf", "Blessing Umeh", "blessing.umeh.dev@gmail.com",
     """Blessing Umeh
blessing.umeh.dev@gmail.com | +234 812 555 0188 | Owerri, Nigeria

SUMMARY
Front-end-leaning full-stack engineer, 5 years. Deep React/TypeScript, comfortable Node/Express, light AWS. Looking to grow backend depth on a strong team.

SKILLS
React, TypeScript, Redux, Node.js, Express, PostgreSQL basics, REST, Docker basics, AWS (S3, Lambda basics), Jest, React Testing Library, Figma.

EXPERIENCE
Engineer II, Nairabox (2021-present)
- Own the React web app for a consumer payments product (60+ screens).
- Built Express endpoints for statements and receipts; basic PostgreSQL queries.
Engineer, Flexwork Studios (2019-2021)
- Marketing sites and internal React dashboards.

EDUCATION
BSc Computer Science, Federal University of Technology Owerri, 2018.

TOOLS
Docker (dev only), GitHub, Vercel, AWS console."""),
    ("09-ngozi-chukwu-backend", "pdf", "Ngozi Chukwu", "ngozi.chukwu.eng@gmail.com",
     """Ngozi Chukwu
ngozi.chukwu.eng@gmail.com | +234 803 555 0199 | Enugu, Nigeria

SUMMARY
Backend-focused engineer, 6 years, Node.js and PostgreSQL. React is functional but not my strength. Strong on data modelling, queues and reliability.

SKILLS
Node.js, Express, NestJS, PostgreSQL, Redis, BullMQ, REST, Docker, AWS (ECS, RDS), GitHub Actions, Jest, supertest, database migrations, cron and queue design.

EXPERIENCE
Senior Backend Engineer, Gridlight Energy (2021-present)
- Node/NestJS services on AWS ECS; PostgreSQL schema ownership for metering data.
- Moved nightly batch jobs to BullMQ queues; cut reporting lag from 6h to 20min.
Backend Engineer, Datahut (2018-2021)
- Express APIs, PostgreSQL tuning, ETL pipelines.

EDUCATION
BSc Statistics, University of Nigeria Nsukka, 2016.

TOOLS
Docker, AWS, GitHub Actions, Redis, pgBouncer."""),
    ("10-segun-adeyemi-good", "pdf", "Segun Adeyemi", "segun.adeyemi.dev@gmail.com",
     """Segun Adeyemi
segun.adeyemi.dev@gmail.com | +234 808 555 0200 | Abeokuta, Nigeria

SUMMARY
Full-stack engineer, 5 years, mostly React + Node for SME products. Comfortable taking a ticket from design review to production deploy.

SKILLS
React, TypeScript, Node.js, Express, PostgreSQL, REST, Docker basics, AWS (EC2, S3), GitHub Actions, Jest, basic Playwright.

EXPERIENCE
Full-Stack Engineer, Marketlane (2021-present)
- Built inventory and orders features across React and Express/PostgreSQL.
- Migrated deploys from manual EC2 to Docker images via GitHub Actions.
Junior Engineer, Techhatch (2019-2021)
- CRMs and dashboards for small business clients.

EDUCATION
BSc Computer Science, Federal University of Agriculture Abeokuta, 2018.

TOOLS
Docker (dev), AWS EC2/S3, GitHub Actions."""),
    ("11-emeka-nwosu-good-mentor", "pdf", "Emeka Nwosu", "emeka.nwosu.dev@gmail.com",
     """Emeka Nwosu
emeka.nwosu.dev@gmail.com | +234 811 555 0211 | Awka, Nigeria

SUMMARY
Full-stack engineer, 6 years, React and Node.js. Informal team lead for a feature squad; mentored three interns who are now junior engineers. No cloud certs yet but production AWS daily.

SKILLS
React, TypeScript, Node.js, Express, PostgreSQL, REST, Docker, AWS (ECS, RDS), GitHub Actions, Jest, React Testing Library, mentoring, code review.

EXPERIENCE
Senior Engineer (squad lead, informal), Softworksiq (2020-present)
- Lead a 4-person feature squad for the billing area; plan sprints and run reviews.
- Built subscription billing in React + Express + PostgreSQL with Stripe.
- Mentored three interns through their first year; all retained as juniors.
Engineer, Digital Ramp (2018-2020)
- React dashboards and Node APIs for education clients.

EDUCATION
BSc Computer Science, Nnamdi Azikiwe University, 2017.

TOOLS
Docker, AWS, GitHub Actions, Stripe."""),
    ("12-halima-bello-frontend", "pdf", "Halima Bello", "halima.bello.mobile@gmail.com",
     """Halima Bello
halima.bello.mobile@gmail.com | +234 805 555 0222 | Sokoto, Nigeria

SUMMARY
Front-end engineer with 3 years in React for web and React Native for mobile. No production Node.js yet; APIs I consume are built by others. Eager to move full-stack.

SKILLS
React, React Native, TypeScript, Redux, REST consumption, Jest, React Testing Library, Expo, Figma.

EXPERIENCE
Front-End Engineer, SokotoApps (2022-present)
- Built a React Native marketplace app (30k installs) and its React web twin.
- Consumed REST APIs; wrote Jest tests for shared components.

EDUCATION
BSc Computer Science, Usmanu Danfodiyo University, 2020.

TOOLS
Expo, Vercel, Firebase (auth only)."""),
    ("13-chinedu-okoro-backend-qa", "pdf", "Chinedu Okoro", "chinedu.okoro.qa@gmail.com",
     """Chinedu Okoro
chinedu.okoro.qa@gmail.com | +234 809 555 0233 | Aba, Nigeria

SUMMARY
Backend engineer moving from QA automation, 4 years. Node.js and Express are my daily tools; PostgreSQL is getting there. No React experience beyond internal admin pages.

SKILLS
Node.js, Express, PostgreSQL (intermediate), REST, Jest, supertest, Cypress (from QA), Docker basics, GitHub Actions basics.

EXPERIENCE
Backend Engineer, Checkmark Systems (2022-present)
- Express APIs for an inspection workflow product; PostgreSQL reporting queries.
QA Automation Engineer, Checkmark Systems (2021-2022)
- Cypress e2e suites; cut regression time from 2 days to 3 hours.

EDUCATION
BSc Computer Science, Michael Okpara University, 2019.

TOOLS
Docker (dev), GitHub Actions, Postgres, Postman."""),
    ("14-amara-nnamdi-bootcamp", "docx", "Amara Nnamdi", "amara.nnamdi.dev@gmail.com",
     """Amara Nnamdi
amara.nnamdi.dev@gmail.com | +234 802 555 0244 | Uyo, Nigeria

SUMMARY
Bootcamp-trained full-stack developer, 3 years, mostly small business projects. React and Node at junior-mid level; learning TypeScript properly now.

SKILLS
JavaScript, React (basic), Node.js (basic), Express, MongoDB (primary DB), PostgreSQL (coursework), Git, Heroku.

EXPERIENCE
Developer, Uyo Digital Studio (2022-present)
- 12 small business sites and booking apps (React front, Express + MongoDB back).
- Moved two projects from JavaScript to TypeScript as a learning exercise.

EDUCATION
BSc Economics, University of Uyo, 2018; AltSchool Africa software engineering diploma, 2022.

TOOLS
Heroku, Render, MongoDB Atlas."""),
    ("15-kelechi-obi-angular", "pdf", "Kelechi Obi", "kelechi.obi.dev@gmail.com",
     """Kelechi Obi
kelechi.obi.dev@gmail.com | +234 806 555 0255 | Owerri, Nigeria

SUMMARY
Engineer, 4 years, Angular + Node. React only in side projects. Database experience is MongoDB, not PostgreSQL. Strong TypeScript fundamentals transfer quickly.

SKILLS
Angular, TypeScript, RxJS, Node.js, Express, MongoDB, REST, Docker, Jest, GitHub Actions basics.

EXPERIENCE
Engineer, Nerve Networks (2021-present)
- Angular front end for a telecom dashboard; Express APIs with MongoDB.
- Dockerized the stack and added GitHub Actions CI.

EDUCATION
BSc Computer Science, Imo State University, 2019.

TOOLS
Docker, MongoDB Atlas, GitHub Actions."""),
    ("16-yusuf-ibrahim-junior", "pdf", "Yusuf Ibrahim", "yusuf.ibrahim@gmail.com",
     """Yusuf Ibrahim
yusuf.ibrahim@gmail.com | +234 813 555 0266 | Jos, Nigeria

SUMMARY
Junior developer, 18 months total including internships. JavaScript and a little React; no professional backend experience yet.

SKILLS
JavaScript, HTML, CSS, React basics, Git, responsive design.

EXPERIENCE
Intern, Plateau Tech Hub (2023-2024)
- Built landing pages and small React widgets under supervision.
Junior Developer, Self-employed (2024-present)
- WordPress tweaks and small React tasks for local businesses.

EDUCATION
BSc Physics, University of Jos, 2022.

TOOLS
VS Code, GitHub, Netlify."""),
    ("17-zainab-ali-wordpress", "pdf", "Zainab Ali", "zainali.dev@gmail.com",
     """Zainab Ali
zainali.dev@gmail.com | +234 803 555 0277 | Ilorin, Nigeria

SUMMARY
Web developer with 2 years of WordPress and PHP work. Some JavaScript; no React or Node.js in production. Looking to retrain into modern JS stacks.

SKILLS
WordPress, PHP, HTML, CSS, basic JavaScript, cPanel hosting, MySQL basics.

EXPERIENCE
Web Developer, Ilorin Webworks (2023-present)
- 25+ WordPress business sites; custom PHP form handlers.
- MySQL backups and migrations.

EDUCATION
BSc Business Administration, University of Ilorin, 2021.

TOOLS
cPanel, phpMyAdmin, Elementor."""),
    ("18-peter-ade-data", "docx", "Peter Ade", "peter.ade.data@gmail.com",
     """Peter Ade
peter.ade.data@gmail.com | +234 805 555 0288 | Makurdi, Nigeria

SUMMARY
Data analyst (2 years) teaching myself web development. SQL is genuinely strong; JavaScript is early. No professional React or Node experience yet.

SKILLS
SQL (advanced), PostgreSQL (as analyst), Python (pandas), Power BI, HTML/CSS, JavaScript basics.

EXPERIENCE
Data Analyst, Benue AgroTech (2023-present)
- Reporting pipelines in SQL and Python; Power BI dashboards for 40 users.
- Built an internal HTML/JS lookup tool for field agents.

EDUCATION
BSc Statistics, Benue State University, 2021.

TOOLS
PostgreSQL, Python, Power BI, Excel."""),
    ("19-grace-etim-junior", "pdf", "Grace Etim", "grace.etim@gmail.com",
     """Grace Etim
grace.etim@gmail.com | +234 810 555 0299 | Calabar, Nigeria

SUMMARY
Junior front-end developer, 1 year. React at tutorial-plus level, no backend exposure, looking for a first role with mentorship.

SKILLS
HTML, CSS, JavaScript, React basics, Git basics, Tailwind.

EXPERIENCE
Intern, Calabar Creatives (2024-2025)
- Coded marketing pages from Figma designs; small React components.

EDUCATION
BSc Mass Communication, University of Calabar, 2023; She Code Africa front-end track, 2024.

TOOLS
VS Code, GitHub Pages, Netlify."""),
    ("20-samuel-idah-qa", "pdf", "Samuel Idah", "samuelidah.qa@gmail.com",
     """Samuel Idah
samuelidah.qa@gmail.com | +234 807 555 0300 | Lokoja, Nigeria

SUMMARY
Manual QA tester, 2 years, learning JavaScript through evenings and weekends. No automation or production engineering experience yet.

SKILLS
Manual testing, test case design, Jira, basic JavaScript, HTML/CSS.

EXPERIENCE
QA Tester, Kogi Softworks (2023-present)
- Wrote and executed test cases for two web products; filed 400+ bugs.

EDUCATION
BSc Computer Science, Federal University Lokoja, 2022.

TOOLS
Jira, TestRail, browser devtools."""),
]


def make_pdf(path: Path, body: str) -> None:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=11)
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.multi_cell(0, 5.5, body)
    pdf.output(str(path))


def make_docx(path: Path, name: str, body: str) -> None:
    doc = Document()
    for para in body.split("\n"):
        doc.add_paragraph(para)
    doc.save(str(path))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for fname, fmt, name, _email, body in CVS:
        path = OUT / f"{fname}.{fmt}"
        if fmt == "pdf":
            make_pdf(path, body)
        else:
            make_docx(path, name, body)
        print(f"  {path.name}  ({path.stat().st_size // 1024} KB)")
    (OUT / "JOB_DESCRIPTION.txt").write_text(
        f"{JD_TITLE}\n\n{JD_TEXT}", encoding="utf8"
    )
    print(f"\n{len(CVS)} CVs + JOB_DESCRIPTION.txt -> {OUT}")


if __name__ == "__main__":
    main()
