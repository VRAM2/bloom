import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.services.care_service import refresh_all_plants
from app.services.notification_service import check_offline_devices, cleanup_old_notifications
from app.services.push_service import push_enabled, send_pending_push

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone=settings.scheduler_timezone)


def start_scheduler() -> None:
    if not settings.scheduler_enabled:
        logger.info("Планировщик отключён (SCHEDULER_ENABLED=false)")
        return

    scheduler.add_job(
        refresh_all_plants,
        CronTrigger(
            hour=settings.scheduler_hour,
            minute=settings.scheduler_minute,
            timezone=settings.scheduler_timezone,
        ),
        id="daily_care",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
        replace_existing=True,
    )

    # проверка «устройство пропало» каждые 5 минут
    scheduler.add_job(
        check_offline_devices,
        IntervalTrigger(minutes=5),
        id="device_offline_check",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )

    # удаление старых уведомлений раз в сутки
    scheduler.add_job(
        cleanup_old_notifications,
        CronTrigger(hour=4, minute=30, timezone=settings.scheduler_timezone),
        id="notifications_cleanup",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )

        # отправка push по новым уведомлениям
    scheduler.add_job(
        send_pending_push,
        IntervalTrigger(seconds=10),
        id="push_dispatch",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    if not push_enabled():
        logger.warning("Web Push отключён: не заданы VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY")

    if settings.scheduler_run_on_startup:
        # догоняем пропущенное, если сервер был выключен в момент ночного запуска;
        # растения с уже готовой записью на сегодня пропускаются
        scheduler.add_job(
            refresh_all_plants,
            "date",
            run_date=datetime.now(ZoneInfo(settings.scheduler_timezone)) + timedelta(seconds=15),
            id="startup_catchup",
            replace_existing=True,
        )

    scheduler.start()
    logger.info(
        "Планировщик запущен: ежедневно в %02d:%02d (%s)",
        settings.scheduler_hour,
        settings.scheduler_minute,
        settings.scheduler_timezone,
    )


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)