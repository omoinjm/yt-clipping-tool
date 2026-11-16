"""Clipper cost guard.

Triggered by (a) the AWS Budget via SNS when real (post-credit) spend crosses the cap, or
(b) a daily schedule that checks remaining Free-plan credits. Either way it hard-stops GPU
spend: disables the Batch queue + compute environment (max 0 vCPU) and cancels all jobs,
then emails the owner with teardown instructions.
"""
import json
import os
from datetime import datetime, timezone

import boto3

batch = boto3.client("batch")
sns = boto3.client("sns")
QUEUE = os.environ["JOB_QUEUE"]
CE = os.environ["COMPUTE_ENV"]
TOPIC = os.environ["ALERT_TOPIC"]
CREDIT_FLOOR = float(os.environ.get("CREDIT_FLOOR_USD", "5"))


def credit_state():
    """(remaining_usd, expiry_datetime) from the Free-plan API, or (None, None) if unavailable."""
    try:
        state = boto3.client("freetier", region_name="us-east-1").get_account_plan_state()
        amount = float(state.get("accountPlanRemainingCredits", {}).get("amount", 0.0))
        return amount, state.get("accountPlanExpirationDate")
    except Exception as e:  # API unavailable after plan changes → don't trip on errors
        print(json.dumps({"msg": "credit check failed", "error": str(e)}))
        return None, None


TEARDOWN_STEPS = """\
YOUR AWS CREDITS ARE {what}. Nothing is processing anymore, but storage, logs and the
image registry still cost a little every month until you delete them.

To delete everything and close the account:

  1. On your machine, in the project folder:
       cd ~/dev/github/projects/njmtech-clipping
       aws login
       ./scripts/teardown.sh --cloudflare
     (type "delete everything" when asked; it removes all AWS resources, the
      dashboard Worker, its D1 database and the R2 clips)

  2. Close the AWS account (console only):
       sign in as root -> account menu (top right) -> Account -> Close account

  3. Optional: delete the Infisical project 'njmtech-clipping' and identity 'clipper-batch'.

Download any clips you want to keep from the dashboard BEFORE step 1.
You'll get this reminder daily until the teardown is done.
"""


def stop_everything(reason, credits_gone=None):
    errors = []

    def step(name, fn):
        try:
            fn()
        except Exception as e:  # keep going: every step independently reduces spend
            errors.append(f"{name}: {e}")

    step("disable queue", lambda: batch.update_job_queue(jobQueue=QUEUE, state="DISABLED"))
    cancelled = 0
    for status in ("SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"):
        try:
            for page in batch.get_paginator("list_jobs").paginate(jobQueue=QUEUE, jobStatus=status):
                for job in page["jobSummaryList"]:
                    batch.terminate_job(jobId=job["jobId"], reason=f"cost guard: {reason}")
                    cancelled += 1
        except Exception as e:
            errors.append(f"cancel {status}: {e}")
    # Disabled + max 0 vCPU: Batch scales the environment to zero and won't launch instances.
    step("disable compute", lambda: batch.update_compute_environment(
        computeEnvironment=CE, state="DISABLED", computeResources={"minvCpus": 0, "maxvCpus": 0}))
    status = (f"Reason: {reason}\nCancelled jobs: {cancelled}\nErrors: {errors or 'none'}\n"
              "GPU queue and compute are disabled; no further GPU spend.\n\n")
    if credits_gone:
        subject = f"ACTION NEEDED: AWS credits {credits_gone} - run scripts/teardown.sh"
        body = TEARDOWN_STEPS.format(what=credits_gone.upper()) + "\n---\n" + status
    else:
        subject = "Clipper cost guard: GPU processing STOPPED (budget cap)"
        body = (status + "This month's real spend passed the $20 budget.\n"
                "To resume: ./scripts/resume.sh\n"
                "To delete everything instead: ./scripts/teardown.sh --cloudflare, then close the account in the console.")
    sns.publish(TopicArn=TOPIC, Subject=subject[:100], Message=body)
    print(json.dumps({"msg": "stopped", "reason": reason, "cancelled": cancelled, "errors": errors}))


def handler(event, context):
    if "Records" in event:  # SNS from AWS Budgets
        stop_everything("monthly budget cap reached (real card spend)")
        return
    credits, expiry = credit_state()
    print(json.dumps({"msg": "daily credit check", "remaining_usd": credits, "expires": str(expiry)}))
    if credits is None:
        return
    if expiry is not None:
        exp = expiry if isinstance(expiry, datetime) else datetime.fromisoformat(str(expiry).replace("Z", "+00:00"))
        if exp <= datetime.now(timezone.utc):
            stop_everything(f"AWS credits expired on {exp:%Y-%m-%d}", credits_gone="expired")
            return
    if credits < CREDIT_FLOOR:
        stop_everything(f"AWS credits nearly exhausted (${credits:.2f} left)", credits_gone="depleted")
