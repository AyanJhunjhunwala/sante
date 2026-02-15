# workers package — rq job functions
import logging

from dotenv import load_dotenv

load_dotenv()  # ensure .env is loaded in the rq worker process

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
