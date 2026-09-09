from typing import Annotated
from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker, Session
from config import settings
from core.errors import database_error

engine = create_engine(settings.database_url, pool_pre_ping=True, hide_parameters=True, pool_size=5, max_overflow=10, pool_timeout=5,
                       connect_args={'connect_timeout': 3, 'options': '-c statement_timeout=10000'})
SessionLocal = sessionmaker(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError as exc:
        raise database_error(db, exc) from None
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

DbSession = Annotated[Session, Depends(get_db)]
