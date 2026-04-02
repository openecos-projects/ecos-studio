#!/usr/bin/env python
# -*- encoding: utf-8 -*-

from fastapi import APIRouter

from ..schemas import (
    ECCRequest,
    ECCResponse
)
from ..services import ecc_service

ecc_serv = ecc_service()

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok"}

@router.post("/create_workspace", response_model=ECCResponse)
async def create_workspace(request: ECCRequest):
    """
    Create a new ECC project.
    """
    return ecc_serv.dispatch(request)


@router.post("/set_pdk_root", response_model=ECCResponse)
async def set_pdk_root(request: ECCRequest):
    """
    Set PDK root path for backend runtime resolution.
    """
    return ecc_serv.dispatch(request)


@router.post("/load_workspace", response_model=ECCResponse)
async def load_workspace(request: ECCRequest):
    """
    Open an existing ECC project.
    """
    return ecc_serv.dispatch(request)


@router.post("/delete_workspace", response_model=ECCResponse)
async def delete_workspace(request: ECCRequest):
    """
    Delete an existing ECC project.
    """
    return ecc_serv.dispatch(request)


@router.post("/rtl2gds", response_model=ECCResponse)
def rtl2gds(request: ECCRequest):
    """
    run rtl2gds flow for current workspace.
    """
    return ecc_serv.dispatch(request)


@router.post("/run_step", response_model=ECCResponse)
async def run_step(request: ECCRequest):
    """
    run step for current workspace.
    """
    return ecc_serv.dispatch(request)


@router.post("/get_info", response_model=ECCResponse)
async def get_info(request: ECCRequest):
    """
    get information by step and id.
    """
    return ecc_serv.dispatch(request)


@router.post("/get_home_page", response_model=ECCResponse)
async def get_home_page(request: ECCRequest):
    """
    get home page information.
    """
    return ecc_serv.dispatch(request)
