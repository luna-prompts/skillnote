import time

import psycopg

DSN = "postgresql://yourskills:yourskills@postgres:5432/yourskills"


def main() -> None:
    retries = 30
    for i in range(retries):
        try:
            with psycopg.connect(DSN) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            print("DB is ready")
            return
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(1)


if __name__ == "__main__":
    main()
