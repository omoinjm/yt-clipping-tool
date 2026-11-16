"""Clipper cost guard.

Triggered by (a) the AWS Budget via SNS when real (post-credit) spend crosses the cap, or
(b) a daily schedule that checks remaining Free-plan credits. Either way it hard-stops GPU
spend: disables the Batch queue + compute environment (max 0 vCPU) and cancels all jobs,
then emails the owner with teardown instructions.
"""
import json
import os

import boto3

batch = boto3.client("batch")
sns = boto3.client("sns")
QUEUE = os.environ["JOB_QUEUE"]
CE = os.environ["COMPUTE_ENV"]
TOPIC = os.environ["ALERT_TOPIC"]
CREDIT_FLOOR = float(os.environ.get("CREDIT_FLOOR_USD", "5"))


def remaining_credits():
    try:
        state = boto3.client("freetier", region_name="us-east-1").get_account_plan_state()
        return float(state.get("accountPlanRemainingCredits", {}).get("amount", 0.0))
    except Exception as e:  # API unavailable after plan changes → don't trip on errors
        print(json.dumps({"msg": "credit check failed", "error": str(e)}))
        return None


def stop_everything(reason):
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
    sns.publish(TopicArn=TOPIC, Subject="Clipper cost guard: GPU processing STOPPED",
                Message=(f"Reason: {reason}\nCancelled jobs: {cancelled}\n"
                         f"Errors: {errors or 'none'}\n\n"
                         "GPU queue and compute are disabled; no further GPU spend.\n"
                         "To delete everything: ./scripts/teardown.sh (then close the account in the console).\n"
                         "To resume instead: ./scripts/resume.sh"))
    print(json.dumps({"msg": "stopped", "reason": reason, "cancelled": cancelled, "errors": errors}))


def handler(event, context):
    if "Records" in event:  # SNS from AWS Budgets
        stop_everything("monthly budget cap reached (real card spend)")
        return
    credits = remaining_credits()
    print(json.dumps({"msg": "daily credit check", "remaining_usd": credits}))
    if credits is not None and credits < CREDIT_FLOOR:
        stop_everything(f"AWS credits nearly exhausted (${credits:.2f} left)")
