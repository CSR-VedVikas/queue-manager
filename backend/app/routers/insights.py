"""AI summary of the dashboard. The numbers come from the same analytics
query the dashboard uses; services/insights.py turns them into prose."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_manager
from app.models import Manager
from app.schemas import FeaturesOut, InsightsOut
from app.services import analytics, insights
from app.services import queue_service as qs

router = APIRouter(prefix="/api", tags=["insights"])


@router.get("/features", response_model=FeaturesOut)
def features():
    """Public: tells the frontend which optional features this server has."""
    return FeaturesOut(ai_summaries=bool(get_settings().anthropic_api_key))


@router.post("/analytics/insights", response_model=InsightsOut)
def analytics_insights(
    queue_id: int | None = None,
    range_: Literal["24h", "7d", "30d"] = Query("7d", alias="range"),
    tz: str | None = Query(None, max_length=64),
    manager: Manager = Depends(current_manager),
    db: Session = Depends(get_db),
    client: Any = Depends(insights.get_client),
):
    scope_name = None
    if queue_id is not None:
        scope_name = qs.get_queue(db, queue_id, manager.id).name  # 404 unless it's theirs
    dashboard = analytics.dashboard(db, manager.id, queue_id, range_, tz)
    req = insights.Request(manager.id, queue_id, range_, dashboard["timezone"])
    try:
        return insights.summarize(client, req, dashboard, scope_name)
    except insights.InsightsError as e:
        raise HTTPException(e.status_code, e.message) from None
