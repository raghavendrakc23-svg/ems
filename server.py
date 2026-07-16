from fastapi import FastAPI, Query, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
import os

app = FastAPI(title="PMU Smart Grid Monitor API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load Data
DEFAULT_DATA_FILE = "pmu_fault_dataset.csv"
datasets = {}

def load_dataset(filepath):
    df_raw = pd.read_csv(filepath)
    df_raw["Record_Index"] = df_raw.index + 1

    # Pre-calculate derived features globally to save time on each request
    if "Voltage" in df_raw.columns and "Current" in df_raw.columns:
        df_raw["Apparent_Power"] = df_raw["Voltage"] * df_raw["Current"]
    if "Voltage_Angle" in df_raw.columns and "Current_Angle" in df_raw.columns:
        df_raw["PF_Angle"] = df_raw["Voltage_Angle"] - df_raw["Current_Angle"]
        df_raw["Power_Factor"] = np.cos(np.radians(df_raw["PF_Angle"]))
        if "Apparent_Power" in df_raw.columns:
            df_raw["Active_Power"] = df_raw["Apparent_Power"] * df_raw["Power_Factor"]
            df_raw["Reactive_Power"] = df_raw["Apparent_Power"] * np.sin(np.radians(df_raw["PF_Angle"]))
    return df_raw

if os.path.exists(DEFAULT_DATA_FILE):
    datasets[DEFAULT_DATA_FILE] = load_dataset(DEFAULT_DATA_FILE)

@app.post("/api/upload")
async def upload_dataset(file: UploadFile = File(...)):
    global datasets
    try:
        content = await file.read()
        filename = file.filename
        filepath = f"uploaded_{filename}"
        with open(filepath, "wb") as f:
            f.write(content)
        new_df = load_dataset(filepath)
        datasets[filename] = new_df
        return {"message": "Dataset uploaded and processed successfully", "records": len(new_df), "filename": filename}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/datasets")
def get_datasets():
    return {"datasets": list(datasets.keys())}

@app.delete("/api/datasets")
def clear_datasets():
    global datasets
    datasets.clear()
    return {"message": "All datasets cleared."}

def get_df(dataset_name: str = None):
    if not datasets:
        return pd.DataFrame()
    if dataset_name and dataset_name in datasets:
        return datasets[dataset_name]
    # Return the first one as default
    return next(iter(datasets.values()))

@app.get("/api/buses")
def get_buses(dataset: str = Query(None, description="Dataset name")):
    df_raw = get_df(dataset)
    if df_raw.empty:
        return {"buses": []}
    buses = sorted(df_raw["Bus_ID"].unique().tolist())
    return {"buses": buses}

@app.get("/api/data")
def get_data(
    dataset: str = Query(None, description="Dataset name"),
    bus: int = Query(None, description="Bus ID filter"),
    condition: str = Query("All Records", description="Condition filter (All Records, Normal Only, Fault Only)"),
    start_record: int = Query(1, description="Start record index"),
    end_record: int = Query(2000, description="End record index")
):
    df_raw = get_df(dataset)
    if df_raw.empty:
        return {"error": "Data file not found."}

    df = df_raw.iloc[start_record - 1 : end_record].copy()

    if bus is not None and "Bus_ID" in df.columns:
        df = df[df["Bus_ID"] == bus]

    if condition == "Normal Only" and "Class_Label" in df.columns:
        df = df[df["Class_Label"] == 0]
    elif condition == "Fault Only" and "Class_Label" in df.columns:
        df = df[df["Class_Label"] == 1]

    # Overall KPIs
    total = len(df)
    fault_count = int(df["Class_Label"].sum()) if total > 0 and "Class_Label" in df.columns else 0
    normal_count = total - fault_count
    fault_pct = (fault_count / total * 100) if total > 0 else 0.0

    avg_voltage = float(df["Voltage"].mean()) if total > 0 and "Voltage" in df.columns else 0.0
    avg_current = float(df["Current"].mean()) if total > 0 and "Current" in df.columns else 0.0
    avg_freq = float(df["Frequency"].mean()) if total > 0 and "Frequency" in df.columns else 0.0
    avg_pf = float(df["Power_Factor"].mean()) if total > 0 and "Power_Factor" in df.columns else 0.0

    # Power metrics
    avg_S = df["Apparent_Power"].mean() if total > 0 and "Apparent_Power" in df.columns else 0.0
    avg_P = df["Active_Power"].mean() if total > 0 and "Active_Power" in df.columns else 0.0
    avg_Q = df["Reactive_Power"].mean() if total > 0 and "Reactive_Power" in df.columns else 0.0
    avg_PF_angle = df["PF_Angle"].mean() if total > 0 and "PF_Angle" in df.columns else 0.0

    # For trend charts and scatter, we might want to sample if the data is too large, 
    # but since max is usually thousands, we can send it. We'll replace NaNs with None for JSON.
    df = df.replace({np.nan: None})
    records = df.to_dict(orient="records")

    return {
        "metrics": {
            "total": total,
            "fault_count": fault_count,
            "normal_count": normal_count,
            "fault_pct": float(fault_pct),
            "avg_voltage": float(avg_voltage),
            "avg_current": float(avg_current),
            "avg_freq": float(avg_freq),
            "avg_S": float(avg_S),
            "avg_P": float(avg_P),
            "avg_Q": float(avg_Q),
            "avg_PF": float(avg_pf),
            "avg_PF_angle": float(avg_PF_angle),
        },
        "records": records
    }

@app.get("/api/scorecard")
def get_scorecard(dataset: str = Query(None, description="Dataset name")):
    df_raw = get_df(dataset)
    if df_raw.empty:
        return {"error": "Data file not found."}
    
    if "Bus_ID" not in df_raw.columns:
        return []
    
    agg_dict = {"Total": ("Record_Index", "count")}
    if "Class_Label" in df_raw.columns:
        agg_dict["Faults"] = ("Class_Label", "sum")
    if "Voltage" in df_raw.columns:
        agg_dict["Avg_Voltage"] = ("Voltage", "mean")
    if "Current" in df_raw.columns:
        agg_dict["Avg_Current"] = ("Current", "mean")
    if "Frequency" in df_raw.columns:
        agg_dict["Avg_Frequency"] = ("Frequency", "mean")
    if "Apparent_Power" in df_raw.columns:
        agg_dict["Avg_S"] = ("Apparent_Power", "mean")
    if "Power_Factor" in df_raw.columns:
        agg_dict["Avg_PF"] = ("Power_Factor", "mean")

    scorecard = df_raw.groupby("Bus_ID").agg(**agg_dict).reset_index()
    
    if "Faults" in scorecard.columns:
        scorecard["Faults"] = scorecard["Faults"].astype(int)
        scorecard["Fault_Rate_Pct"] = (scorecard["Faults"] / scorecard["Total"] * 100).round(2)
        scorecard["Normal"] = scorecard["Total"] - scorecard["Faults"]
    else:
        scorecard["Faults"] = 0
        scorecard["Fault_Rate_Pct"] = 0.0
        scorecard["Normal"] = scorecard["Total"]
    
    for c in ["Avg_Voltage", "Avg_Current", "Avg_Frequency", "Avg_S", "Avg_PF"]:
        if c not in scorecard.columns:
            scorecard[c] = 0.0
    
    def get_health(rate):
        if rate < 45: return "Healthy"
        elif rate <= 50: return "Warning"
        else: return "Critical"
        
    scorecard["Health"] = scorecard["Fault_Rate_Pct"].apply(get_health)
    scorecard = scorecard.sort_values("Fault_Rate_Pct", ascending=False)
    
    return scorecard.to_dict(orient="records")

# Mount public directory
if not os.path.exists("public"):
    os.makedirs("public")
    
app.mount("/static", StaticFiles(directory="public"), name="static")

@app.get("/")
def serve_index():
    return FileResponse("public/index.html")

@app.get("/robots.txt")
def serve_robots():
    return FileResponse("public/robots.txt")

@app.get("/sitemap.xml")
def serve_sitemap():
    return FileResponse("public/sitemap.xml")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
