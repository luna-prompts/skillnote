FROM python:3.12-slim

WORKDIR /app

COPY . /app
RUN pip install --no-cache-dir -q -U pip && pip install --no-cache-dir -q . \
    && addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app

USER app
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
