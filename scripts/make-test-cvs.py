"""Generate 10 varied test CVs (mixed PDF/DOCX) into test-cvs/.

Matches the Week 1 definition of done ("10 mixed PDF/DOCX CVs") and seeds
edge cases for later weeks:
  - 09 has NO email            -> exercises the inline "needs email" flow
  - 10 shares an email with 01 -> exercises the duplicate flag
  - strengths vary             -> sensible ranking once Week 2 scoring lands

Suggested matching JD when creating the test job:
  "Senior Backend Engineer" — Python/Go, PostgreSQL, Docker, Kubernetes,
  AWS, 5+ years experience.

Usage:  python scripts/make-test-cvs.py
"""
import subprocess
import sys
from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).resolve().parent.parent / "test-cvs"

CVS = [
    # (filename, format, name, email, body)
    ("01-amara-okafor-strong", "pdf", "Amara Okafor", "amara.okafor@example.com",
     """Amara Okafor
amara.okafor@example.com | +44 7700 900123 | London, UK

SUMMARY
Senior backend engineer with 9 years of experience designing high-throughput
services in Python and Go. Led a payments platform handling 40k req/min.

SKILLS
Python, Go, distributed systems, API design, performance tuning, PostgreSQL
query optimization, event-driven architecture (Kafka, SQS).

EXPERIENCE
Senior Backend Engineer, Finstack Ltd (2020-present)
- Owned the payments core (Go, PostgreSQL, Kubernetes), 99.99% uptime.
- Cut p99 latency 480ms -> 90ms via query and caching redesign.
Backend Engineer, Datawave (2016-2020)
- Built ingestion pipelines (Python, Kafka) for 200+ data sources.

EDUCATION
BSc Computer Science, University of Manchester, 2015.

CERTIFICATIONS
AWS Certified Solutions Architect - Associate (2023).

TOOLS
Docker, Kubernetes, Terraform, AWS (EKS, RDS, Lambda), Git, Grafana."""),
    ("02-david-chen-mid", "docx", "David Chen", "david.chen@example.com",
     """David Chen
david.chen@example.com | Berlin, Germany

SUMMARY
Backend developer, 6 years, mostly Python/Django and PostgreSQL. Comfortable
with Docker; cloud exposure is limited to small AWS deployments.

SKILLS
Python, Django, REST APIs, PostgreSQL, basic Celery/Redis queues.

EXPERIENCE
Backend Developer, Shopkit GmbH (2019-present)
- Shipped order-management APIs used by 3 warehouse teams.
Developer, WebWorks (2016-2019)
- Maintained e-commerce backends and internal dashboards.

EDUCATION
BEng Software Engineering, TU Berlin, 2016.

TOOLS
Docker, Git, PostgreSQL, Linux, pytest."""),
    ("03-priya-nair-frontend-lean", "docx", "Priya Nair", "priya.nair@example.com",
     """Priya Nair
priya.nair@example.com | Bangalore, India

SUMMARY
Full-stack developer (5 years) with a frontend center of gravity: React,
TypeScript, and Node.js services. Strong product sense, lighter on
infrastructure.

SKILLS
JavaScript, TypeScript, React, Node.js/Express, REST, basic PostgreSQL.

EXPERIENCE
Full-stack Developer, Cartloop (2021-present)
- Built customer-facing dashboards (React/TS) and Node BFF layer.
Developer, Infosoft (2018-2021)
- CRM modules and internal tooling.

EDUCATION
BTech Information Technology, VIT, 2018.

CERTIFICATIONS
Meta Front-End Developer Certificate (2022).

TOOLS
Git, VS Code, Vercel, Jest, Figma."""),
    ("04-tom-becker-weak", "pdf", "Tom Becker", "tom.becker@example.com",
     """Tom Becker
tom.becker@example.com | Leeds, UK

SUMMARY
Junior developer, 2 years, mainly PHP/WordPress sites and light JS. Bootcamp
graduate, eager to learn backend engineering.

SKILLS
PHP, JavaScript basics, HTML/CSS, MySQL basics.

EXPERIENCE
Web Developer, SmallSites Agency (2023-present)
- Built and maintained WordPress sites for local businesses.

EDUCATION
Code Bootcamp Leeds (2022), full-stack web development.

TOOLS
WordPress, phpMyAdmin, Git (basic)."""),
    ("05-sofia-marino-strong", "docx", "Sofia Marino", "sofia.marino@example.com",
     """Sofia Marino
sofia.marino@example.com | Milan, Italy

SUMMARY
Staff engineer with 11 years across Go and Python platforms. Deep Kubernetes
and infrastructure-as-code background; led platform teams of 8.

SKILLS
Go, Python, platform engineering, SRE practices, PostgreSQL, Kafka,
capacity planning, incident command.

EXPERIENCE
Staff Platform Engineer, CloudNine (2018-present)
- Built multi-region Kubernetes platform (EKS, Terraform) serving 300 devs.
Senior Engineer, Syslogic (2013-2018)
- Payments and identity services in Go.

EDUCATION
MSc Computer Science, Politecnico di Milano, 2013.

CERTIFICATIONS
Certified Kubernetes Administrator (CKA, 2021).
HashiCorp Terraform Associate (2022).

TOOLS
Kubernetes, Terraform, AWS, Prometheus, Grafana, Helm, Docker, Git."""),
    ("06-james-oneill-mid", "pdf", "James O'Neill", "james.oneill@example.com",
     """James O'Neill
james.oneill@example.com | Dublin, Ireland

SUMMARY
Backend engineer, 7 years, Java/Spring and PostgreSQL in enterprise
settings. Solid engineer; Docker yes, cloud/Kubernetes no.

SKILLS
Java, Spring Boot, SQL, PostgreSQL, messaging (ActiveMQ), integration APIs.

EXPERIENCE
Backend Engineer, BankPro (2018-present)
- Regulatory reporting services (Spring Boot, PostgreSQL).
Developer, TechnoIrish (2015-2018)
- Internal enterprise systems.

EDUCATION
BSc Computing, Trinity College Dublin, 2015.

TOOLS
Docker, Git, Maven, Jenkins, PostgreSQL."""),
    ("07-lena-fischer-midstrong", "docx", "Lena Fischer", "lena.fischer@example.com",
     """Lena Fischer
lena.fischer@example.com | Munich, Germany

SUMMARY
Backend developer, 6 years, Python/FastAPI on AWS. Ships clean services,
solid Docker/CI practice, some EKS exposure through work projects.

SKILLS
Python, FastAPI, PostgreSQL, Redis, async APIs, testing (pytest), CI/CD.

EXPERIENCE
Senior Developer, MoveIt Logistics (2020-present)
- Routing and pricing services (FastAPI, RDS, ElastiCache).
Developer, Softline (2018-2020)
- Data backfills and reporting APIs.

EDUCATION
BSc Informatics, LMU Munich, 2018.

TOOLS
Docker, AWS (EC2, RDS, Lambda), GitHub Actions, Git."""),
    ("08-marcus-webb-weakmid", "pdf", "Marcus Webb", "marcus.webb@example.com",
     """Marcus Webb
marcus.webb@example.com | Bristol, UK

SUMMARY
Developer with 3 years across WordPress and light JS work; some Node scripts
and a bit of MySQL. Growing into backend roles.

SKILLS
JavaScript, PHP, Node.js basics, MySQL basics.

EXPERIENCE
Developer, BrightSites (2022-present)
- Marketing sites plus occasional Node utility scripts.

EDUCATION
Self-taught + online courses (The Odin Project, 2021).

TOOLS
WordPress, Git, MySQL, npm."""),
    ("09-nadia-haddad-no-email", "docx", "Nadia Haddad", None,
     """Nadia Haddad
Toronto, Canada | +1 416 555 0187

SUMMARY
Backend engineer with 8 years in Python microservices and PostgreSQL.
Migrated a monolith to 14 services on ECS; comfortable with Docker and
entry-level Kubernetes.

SKILLS
Python, microservices, PostgreSQL, SQLAlchemy, REST, gRPC basics.

EXPERIENCE
Senior Engineer, NorthTelecom (2019-present)
- Led monolith decomposition; owned billing service.
Developer, MapleSoft (2016-2019)
- CRM backend features.

EDUCATION
BEng Computer Engineering, University of Toronto, 2016.

TOOLS
Docker, AWS (ECS, RDS), Git, Jenkins."""),
    ("10-amara-consulting-duplicate", "docx", "Amara Okafor (Consulting CV)", "amara.okafor@example.com",
     """Amara Okafor - Consulting Profile
amara.okafor@example.com | London, UK

SUMMARY
Same candidate as CV 01, second application to test duplicate detection.
Independent consultant since 2024: architecture reviews and Go/Python
platform work.

SKILLS
Python, Go, architecture reviews, PostgreSQL, Kubernetes.

EXPERIENCE
Independent Consultant (2024-present)
- Fractional platform/architecture engagements.

TOOLS
Docker, Kubernetes, AWS, Terraform."""),
]


def make_pdf(path: Path, text: str) -> None:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", size=11)
    pdf.multi_cell(0, 6, text)
    pdf.output(path)


def make_docx(path: Path, text: str) -> None:
    md = path.with_suffix(".md")
    md.write_text(text, encoding="utf-8")
    subprocess.run(
        ["pandoc", str(md), "-o", str(path)],
        check=True,
        capture_output=True,
    )
    md.unlink()


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for slug, fmt, name, email, body in CVS:
        path = OUT / f"{slug}.{fmt}"
        (make_pdf if fmt == "pdf" else make_docx)(path, body)
        tag = "NO EMAIL" if email is None else email
        print(f"  {path.name:42} {tag}")
    print(f"\n{len(CVS)} CVs written to {OUT}")


if __name__ == "__main__":
    sys.exit(main())
