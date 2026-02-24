FROM python:3.12-slim

WORKDIR /app

COPY . /app
RUN pip install --no-cache-dir -U pip && pip install --no-cache-dir .

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
