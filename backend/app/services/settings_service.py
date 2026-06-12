from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.models.setting import Setting


class SettingsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, key: str) -> Optional[str]:
        result = await self.db.execute(
            select(Setting).where(Setting.key == key)
        )
        setting = result.scalar_one_or_none()
        return setting.value if setting else None

    async def set(self, key: str, value: Optional[str]) -> None:
        result = await self.db.execute(
            select(Setting).where(Setting.key == key)
        )
        setting = result.scalar_one_or_none()

        if setting:
            setting.value = value
        else:
            try:
                self.db.add(Setting(key=key, value=value))
                await self.db.flush()
            except IntegrityError:
                await self.db.rollback()
                result = await self.db.execute(
                    select(Setting).where(Setting.key == key)
                )
                setting = result.scalar_one()
                setting.value = value

        await self.db.commit()
